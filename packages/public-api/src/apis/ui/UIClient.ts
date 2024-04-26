import type { Effect, Toast as ToastProto } from '@devvit/protos';
import { EffectType, Form, ToastAppearance } from '@devvit/protos';
import { Devvit } from '../../devvit/Devvit.js';
import type { BlocksReconciler } from '../../devvit/internals/blocks/BlocksReconciler.js';
import type { Data } from '../../types/data.js';
import type { FormKey } from '../../types/form.js';
import type { Toast } from '../../types/toast.js';
import type { UIClient as _UIClient } from '../../types/ui-client.js';
import { assertValidFormFields } from './helpers/assertValidFormFields.js';
import { transformFormFields } from './helpers/transformForm.js';
import type { Comment, Post, Subreddit, User } from '../reddit/models/index.js';

export class UIClient implements _UIClient {
  #effects: Effect[] = [];

  #reconciler: BlocksReconciler | undefined;

  constructor(reconciler?: BlocksReconciler) {
    this.#reconciler = reconciler;
  }

  showForm(formKey: FormKey, data?: Data | undefined): void {
    let formDefinition = Devvit.formDefinitions.get(formKey);

    if (!formDefinition && this.#reconciler) {
      const hookForm = this.#reconciler.forms.get(formKey);

      if (hookForm) {
        formDefinition = {
          form: hookForm,
          onSubmit: () => {}, // no-op
        };
      }
    }

    if (!formDefinition) {
      throw new Error(
        'Form does not exist. Make sure you have added it using Devvit.createForm at the root of your app.'
      );
    }

    const formData =
      formDefinition.form instanceof Function
        ? formDefinition.form(data ?? {})
        : formDefinition.form;

    const form = Form.fromPartial({
      id: formKey,
      title: formData.title,
      acceptLabel: formData.acceptLabel,
      cancelLabel: formData.cancelLabel,
      shortDescription: formData.description,
    });

    assertValidFormFields(formData.fields);
    form.fields = transformFormFields(formData.fields);

    this.#effects.push({
      type: EffectType.EFFECT_SHOW_FORM,
      showForm: {
        form,
      },
    });
  }

  showToast(text: string): void;
  showToast(toast: Toast): void;
  showToast(textOrToast: string | Toast): void {
    let toast: ToastProto;

    if (textOrToast instanceof Object) {
      toast = {
        text: textOrToast.text,
        appearance:
          textOrToast.appearance === 'success' ? ToastAppearance.SUCCESS : ToastAppearance.NEUTRAL,
      };
    } else {
      toast = {
        text: textOrToast,
      };
    }

    this.#effects.push({
      type: EffectType.EFFECT_SHOW_TOAST,
      showToast: {
        toast,
      },
    });
  }

  navigateTo(url: string): void;
  navigateTo(subreddit: Subreddit): void;
  navigateTo(post: Post): void;
  navigateTo(comment: Comment): void;
  navigateTo(user: User): void;
  navigateTo(thingOrUrl: string | Subreddit | Post | Comment | User): void {
    let url: string;

    if (typeof thingOrUrl === 'string') {
      // Validate URL
      url = new URL(thingOrUrl).toString();
    } else {
      url = new URL(thingOrUrl.permalink, 'https://www.reddit.com').toString();
    }
    this.#effects.push({
      type: EffectType.EFFECT_NAVIGATE_TO_URL,
      navigateToUrl: {
        url,
      },
    });
  }

  /** @internal */
  get __effects(): Effect[] {
    return this.#effects;
  }
}
