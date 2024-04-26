/** @jsx Devvit.createElement */
/** @jsxFrag Devvit.Fragment */

import { describe, expect, test } from 'vitest';
import { hookRefToFormKey, useForm } from './useForm.js';
import { useState } from './useState.js';
import { useUI } from './UIClient.js';
import { Devvit } from '../../../Devvit.js';
import { EffectType, UIEvent, FormFieldType } from '@devvit/protos';
import { BlocksHandler } from './BlocksHandler.js';
import { EmptyRequest, generatePressRequest, mockMetadata } from './test-helpers.js';
import { captureHookRef } from './refs.js';
import type { HookRef } from './types.js';

const buttonRef: HookRef = {};
const formRef: HookRef = {};
let submitCount = 0;

const App = (): JSX.Element => {
  const ui = useUI();
  const form = captureHookRef(
    useForm(
      {
        title: 'Test Form',
        description: 'This is a test form',
        acceptLabel: 'Yup',
        cancelLabel: 'Nope',
        fields: [
          {
            type: 'string',
            name: 'name',
            label: 'Name',
          },
        ],
      },
      () => {
        submitCount++;
      }
    ),
    formRef
  );
  return (
    <button
      onPress={captureHookRef(() => {
        ui.showForm(form);
      }, buttonRef)}
    >
      Open Form
    </button>
  );
};

describe('useForm', () => {
  test('emits an effect on render', async () => {
    const handler = new BlocksHandler(App);
    await handler.handle(EmptyRequest, mockMetadata);
    const response = await handler.handle(generatePressRequest(buttonRef), mockMetadata);
    expect(response).toMatchSnapshot();
    expect(response.effects).toHaveLength(1);
    expect(response.effects[0].type).toBe(EffectType.EFFECT_SHOW_FORM);
  });

  test('calls onSubmit when a form is submitted', async () => {
    submitCount = 0;
    const handler = new BlocksHandler(App);
    await handler.handle(EmptyRequest, mockMetadata);
    const response = await handler.handle(generatePressRequest(buttonRef), mockMetadata);
    const event: UIEvent = UIEvent.fromPartial({
      formSubmitted: {
        formId: hookRefToFormKey(formRef),
        results: {
          name: {
            stringValue: 'Genghis Corgi',
          },
        },
      },
      hook: formRef.id,
    });
    const req = { events: [event], state: response.state };
    await handler.handle(req, mockMetadata);
    expect(submitCount).toBe(1);
  });

  test('test rendering FormSubmittedEvent', async () => {
    const App = (): JSX.Element => {
      const ui = useUI();
      const [name, setName] = useState('');
      const form = captureHookRef(
        useForm(
          {
            title: 'Test Form',
            description: 'This is a test form',
            fields: [
              {
                type: 'string',
                name: 'name2',
                label: 'Name',
              },
            ],
          },
          ({ name }) => setName(name)
        ),
        formRef
      );
      return (
        <vstack>
          <button
            onPress={captureHookRef(() => {
              ui.showForm(form);
            }, buttonRef)}
          >
            Open Form
          </button>
          <text size="large">{name}</text>;
        </vstack>
      );
    };

    const handler = new BlocksHandler(App);
    await handler.handle(EmptyRequest, mockMetadata);
    const pressRsp = await handler.handle(generatePressRequest(buttonRef), mockMetadata);
    const event: UIEvent = {
      formSubmitted: {
        formId: hookRefToFormKey(formRef),
        results: {
          name: {
            stringValue: 'Genghis Corgi',
            fieldType: FormFieldType.STRING,
            numberValue: undefined,
            boolValue: undefined,
          },
        },
      },
      hook: formRef.id,
    };
    const submitReq = { events: [event], state: pressRsp.state };
    const submitRsp = await handler.handle(submitReq, mockMetadata);
    expect(submitRsp).toMatchSnapshot();
  });
});
