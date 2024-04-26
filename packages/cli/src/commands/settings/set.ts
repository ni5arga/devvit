import { Args } from '@oclif/core';
import { createAppClient, createAppSettingsClient } from '../../util/clientGenerators.js';
import { SettingsValues, FormFieldType } from '@devvit/protos';
import { StringUtil } from '@devvit/shared-types/StringUtil.js';
import inquirer from 'inquirer';
import { ux } from '@oclif/core';
import { TwirpError, TwirpErrorCode } from 'twirp-ts';
import { ProjectCommand } from '../../util/commands/ProjectCommand.js';
import { getAppBySlug } from '../../util/utils.js';

export default class SetAppSettings extends ProjectCommand {
  static override description =
    'Create and update settings for your app. These settings will be added at the global app-scope.';
  readonly #appSettingsService = createAppSettingsClient(this);
  readonly #appService = createAppClient(this);

  static override args = {
    settingsKey: Args.string({
      description: 'Settings key to add',
      required: true,
    }),
  };

  async #promptSettingValue(settingsKey: string): Promise<string> {
    const promptMessage = `Enter the value you would like to assign to the variable ${settingsKey}:`;
    const res = await inquirer.prompt<{ settingValue: string }>([
      {
        name: 'settingValue',
        message: promptMessage,
        type: 'input',
      },
    ]);
    return res.settingValue;
  }

  override async run(): Promise<void> {
    const { args } = await this.parse(SetAppSettings);
    const settingsKey = args.settingsKey;
    const settingsValue = await this.#promptSettingValue(settingsKey);

    const projectConfig = await this.getProjectConfig();
    const appName = projectConfig.slug ?? projectConfig.name;
    ux.action.start('Updating app settings');
    try {
      const appInfo = await getAppBySlug(this.#appService, appName);
      if (!appInfo?.app?.id) {
        ux.action.stop(
          `❌ Your app doesn't exist yet - you'll need to run 'devvit upload' before you can set settings.`
        );
        return;
      }
      const response = await this.#appSettingsService.UpdateSettings({
        appId: appInfo.app.id as string,
        settings: SettingsValues.fromPartial({
          settings: {
            [settingsKey]: {
              fieldType: FormFieldType.STRING,
              stringValue: settingsValue,
            },
          },
        }),
      });
      if (!response.success) {
        this.error(`${JSON.stringify(response.errors)}`);
      }
      ux.action.stop(`✅ Successfully added app settings for ${settingsKey}!`);
    } catch (err) {
      if (err instanceof TwirpError) {
        if (err.code === TwirpErrorCode.NotFound) {
          const msg = err.message.includes('addSettings')
            ? `Unable to lookup the setting key: ${settingsKey}, please verify Devvit.addSettings was used in your app and the setting's scope is set to SettingScope.App.`
            : 'Please install your app before listing settings.';
          ux.action.stop(`❌ ${msg}`);
          return;
        }
      }
      this.error(StringUtil.caughtToString(err));
    }
  }
}
