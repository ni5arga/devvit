import {
  EffectType,
  type Effect,
  type Metadata,
  type UIEvent,
  type UIRequest,
  type UIResponse,
} from '@devvit/protos';
import { ContextBuilder } from './ContextBuilder.js';
import { BlocksTransformer } from '../BlocksTransformer.js';
import type { BlockElement } from '../../../Devvit.js';
import type { ReifiedBlockElement, ReifiedBlockElementOrLiteral } from '../BlocksReconciler.js';
import type { Hook, HookSegment, HookParams, Props, BlocksState } from './types.js';
import { RenderInterruptError } from './types.js';
import { RenderContext } from './RenderContext.js';
import type { JSONValue } from '@devvit/shared-types/json.js';
import type { EffectEmitter } from '../EffectEmitter.js';

/**
 * This can be a global/singleton because render is synchronous.
 *
 * If you want to use this from somewhere else, please consider using one of the
 * functions like isRendering or registerHook, and then try to add additional
 * functions here if needed.  Don't use this directly.
 */
export let _activeRenderContext: RenderContext | null = null;

export function useEffectEmitter(): EffectEmitter {
  if (!_activeRenderContext) {
    throw new Error('Hooks can only be declared at the top of a component.');
  }
  return _activeRenderContext;
}

export function isRendering(): boolean {
  return _activeRenderContext !== null;
}

function _structuredClone<T extends JSONValue>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * This is the recommended low-level interface for creating hooks like useState or useAsync.
 *
 * Practically, this initializes your hook if it doesn't already exist, and makes sure
 * that its state gets all sync'd up.
 *
 * @param HookSegment -- A name for this hook.  This is used to dedupe hooks.
 * @param initializer
 *    factory for building this hook
 * @returns
 */
export function registerHook<H extends Hook>(
  options: HookSegment,
  initializer: (p: HookParams) => H
): H {
  if (!_activeRenderContext) {
    throw new Error(
      "Hooks can only be declared at the top of a component.  You cannot declare hooks outside\
    of components or inside of event handlers.  It's almost always a mistake to declare hooks inside of loops or\
    conditionals."
    );
  }
  const hookId = _activeRenderContext.nextHookId(options);
  const context = _activeRenderContext;
  const params: HookParams = {
    hookId,
    changed: () => {
      context._changed[hookId] = true;
      context._state[hookId] = context?._hooks[hookId]?.state;
    },
    context: _activeRenderContext,
  };
  const fromNull = _activeRenderContext._state[hookId] === undefined;
  _activeRenderContext._hooks[hookId] = _activeRenderContext._hooks[hookId] ?? initializer(params);
  const hook: H = _activeRenderContext._hooks[hookId] as H;

  if (_activeRenderContext._state[hookId] !== undefined) {
    hook.state = _activeRenderContext._state[hookId];
  }
  if (hook.onLoad) {
    hook.onLoad(_activeRenderContext);
  }
  if (fromNull && hook.state !== undefined && hook.state !== null) {
    params.changed();
  }
  return hook;
}

export let _latestBlocksHandler: BlocksHandler | null = null;

/**
 * Replacing BlocksReconciler, the model is now less of a "reconciliation", and more
 * of a handling a request/response lifecycle.
 *
 */
export class BlocksHandler {
  #root: JSX.ComponentFunction;
  #contextBuilder: ContextBuilder = new ContextBuilder();
  #blocksTransformer: BlocksTransformer = new BlocksTransformer();
  _latestRenderContext: RenderContext | null = null;

  constructor(root: JSX.ComponentFunction) {
    this.#root = root;
    _latestBlocksHandler = this;
  }

  async handle(request: UIRequest, metadata?: Metadata): Promise<UIResponse> {
    const context = new RenderContext(request);
    const devvitContext = this.#contextBuilder.buildContext(context, metadata!);
    context.devvitContext = devvitContext;

    let blocks;

    /**
     * Events on the main queue must be handled in order, so that state is updated in the correct order.  Events
     * on other queues can be handled in parallel, because they only emit effects.
     *
     * There is an optimization here to process SendEventEffects locally, instead of letting them bubble up to the
     * platform.  This prevents a round trip to the platform for every event.
     *
     * This also means we need to respect execution queues here, and not just in the platform.
     */
    const eventsToProcess = request.events;
    const noEvents = !request.events?.length;
    const isMainQueue = noEvents || eventsToProcess.some((e) => !e.async);

    const isBlockingSSR = eventsToProcess.some((e) => e.blocking);

    let progress:
      | {
          _state: BlocksState;
          _effects: { [key: string]: Effect };
        }
      | undefined;
    let remaining: UIEvent[] = [...eventsToProcess];

    while (eventsToProcess.length > 0) {
      /**
       * A concurrently executable batch is a set of events that can be executed in parallel.  This either one main queue event,
       * or any number of other queue events.
       */
      const batch = [];
      if (!eventsToProcess[0].async) {
        batch.push(eventsToProcess.shift()!);
      } else {
        while (eventsToProcess[0]?.async) {
          batch.push(eventsToProcess.shift()!);
        }
      }
      if (!batch.length) throw Error('batch must have at least one event');
      try {
        if (batch[0].async) {
          const stateCopy = _structuredClone(context._state);
          await this.#handleAsyncQueues(context, ...batch);
          // enforce that state updates are only allowed on the main queue.
          context._state = stateCopy;
        } else {
          await this.#handleMainQueue(context, ...batch);
        }
      } catch (e) {
        /**
         * If we have a progress, we can recover from an error by rolling back to the last progress, and then letting the
         * remaining events be reprocessed.
         */
        if (progress) {
          context._state = progress._state;
          context._effects = progress._effects;
          remaining.forEach((e, i) => {
            const effect: Effect = {
              type: EffectType.EFFECT_SEND_EVENT,
              sendEvent: {
                event: e,
                jumpsQueue: true,
              },
            };
            context.emitEffect(`remaining-${i}`, effect);
          });
          break;
        } else {
          throw e;
        }
      }

      /**
       * If we have any SendEventEffects, we can push them back on the queue to process them locally
       */
      for (const [key, effect] of Object.entries(context._effects)) {
        if (effect.sendEvent?.event) {
          if (!isMainQueue && !effect.sendEvent?.event?.async) {
            // We're async, this is a main queue event.  We need to send it back to the platform to let
            // the platform synchronize it.
            break;
          }

          if (isMainQueue && effect.sendEvent?.event?.async && !isBlockingSSR) {
            // We're main queue, and this is an async event.  We're not in SSR mode, so let's prioritize
            // returning control quickly to the platform so we don't block event loops.
            break;
          }

          //Ok, we can handle this event locally.
          const event = effect.sendEvent.event;
          eventsToProcess.push(event);
          delete context._effects[key];
        }
      }

      /**
       * If we're going back through this again, we need to capture the progress, and the remaining events.
       */
      if (eventsToProcess.length > 0) {
        progress = {
          _state: _structuredClone(context._state),
          _effects: { ...context._effects },
        };
        remaining = [...eventsToProcess];
      }
    } // End of while loop

    if (isMainQueue) {
      // Rendering only happens on the main queue.
      const tags = this.#renderRoot(this.#root, context._rootProps ?? {}, context);
      if (tags) {
        blocks = await this.#blocksTransformer.createBlocksElementOrThrow(tags);
        blocks = await this.#blocksTransformer.ensureRootBlock(blocks);
      }
    }

    return {
      state: context._state,
      effects: context.effects,
      blocks,
    };
  }

  #loadHooks(context: RenderContext, ..._events: UIEvent[]): void {
    // TBD: partial rendering
    this.#renderRoot(this.#root, context.request.props ?? {}, context);
  }

  /**
   * These can all run in parallel, because they only emit effects
   */
  async #handleAsyncQueues(context: RenderContext, ...batch: UIEvent[]): Promise<void> {
    this.#loadHooks(context, ...batch);

    await Promise.all(
      batch.map(async (event) => {
        if (!event.async) {
          throw new Error(
            "You can't mix main and other queues in one batch.  This is likely a platform bug.  Please file an issue in the Discord for someone to help! https://discord.com/channels/1050224141732687912/1115441897079574620"
          );
        }
        await this.#attemptHook(context, event);
      })
    );
  }

  async #attemptHook(context: RenderContext, event: UIEvent): Promise<void> {
    const hook = context._hooks[event.hook!];
    if (hook && hook.onUIEvent) {
      try {
        await hook.onUIEvent(event, context);
      } catch (e) {
        console.error('Error in event handler', e);
        throw e;
      }
    } else {
      await context.handleUndeliveredEvent(event);
    }
  }

  async #handleMainQueue(context: RenderContext, ...batch: UIEvent[]): Promise<void> {
    // We need to handle events in order, so that the state is updated in the correct order.
    for (const event of batch) {
      this.#loadHooks(context, event);
      context._state.__generation = Number(context._state.__generation ?? 0) + 1;
      await this.#attemptHook(context, event);
    }
  }

  #renderRoot(
    component: JSX.ComponentFunction,
    props: Props,
    context: RenderContext
  ): ReifiedBlockElement | undefined {
    context._generated = {};
    _activeRenderContext = context;
    this._latestRenderContext = context;
    try {
      const roots = this.#render(component, props, context);
      if (roots.length !== 1) {
        throw new Error('only one root');
      }
      const root = roots[0];
      if (typeof root === 'string') {
        throw new Error(
          'There must be a root tag.  Try wrapping your app in a <text></text>, <vstack> or other tag.'
        );
      }
      return root;
    } catch (e) {
      if (e instanceof RenderInterruptError) {
        return undefined;
      } else {
        throw e;
      }
    } finally {
      _activeRenderContext = null;
    }
  }

  #render(
    component: JSX.ComponentFunction,
    props: Props,
    context: RenderContext
  ): ReifiedBlockElementOrLiteral[] {
    context.push({ namespace: component.name, ...props });
    try {
      const element = component(props, context.devvitContext);
      return this.#renderElement(element, context);
    } finally {
      context.pop();
    }
  }

  #renderList(list: JSX.Element[], context: RenderContext): ReifiedBlockElementOrLiteral[] {
    list = list.flat(Infinity);
    return list.flatMap((e, i) => {
      if (e && typeof e === 'object' && 'props' in e) {
        if (!e.props?.key) {
          e.props = e.props ?? {};
          e.props.key = i;
        }
      }
      return this.#renderElement(e, context);
    });
  }

  #renderElement(element: JSX.Element, context: RenderContext): ReifiedBlockElementOrLiteral[] {
    if (Array.isArray(element)) {
      return this.#renderList(element, context);
    } else if (isBlockElement(element)) {
      if (element.type === undefined) {
        return this.#renderList(element.children, context);
      } else if (typeof element.type === 'function') {
        const propsWithChildren = { ...element.props, children: element.children };
        return this.#render(element.type, propsWithChildren, context);
      } else {
        context.push({ namespace: element.type, ...element.props });
        const reifiedChildren = this.#renderList(element.children, context);
        const reifiedProps = this.#reifyProps(element.props ?? {});
        context.pop();
        return [{ type: element.type, children: reifiedChildren, props: reifiedProps }];
      }
    } else {
      return [(element ?? '').toString()];
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #reifyProps(props: { [key: string]: any }): { [key: string]: string } {
    const reifiedProps: { [key: string]: string } = {};
    for (const key in props) {
      if (typeof props[key] === 'function') {
        const hook = registerHook(
          {
            namespace: key,
            key: false,
          },
          ({ hookId }) => ({ hookId, state: null, onUIEvent: props[key] })
        );
        reifiedProps[key] = hook.hookId;
        if ('captureHookRef' in props[key]) {
          props[key].captureHookRef();
        }
      } else {
        const value = props[key];
        if (value !== undefined && value !== null) {
          reifiedProps[key] = value.toString();
        }
      }
    }
    return reifiedProps;
  }
}

function isBlockElement(e: JSX.Element): e is BlockElement {
  return typeof e === 'object' && e != null && 'type' in e;
}
