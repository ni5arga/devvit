import type {
  AppAccountExistsResponse,
  AppVersionInfo,
  Bundle,
  Categories,
  MediaSignature,
  UploadNewMediaResponse,
} from '@devvit/protos';
import {
  ActorSpec,
  AppCreationRequest,
  AppVersionCreationRequest,
  FullAppInfo,
  GetAppBySlugRequest,
  InstallationType,
  UploadNewMediaRequest,
  VersionVisibility,
} from '@devvit/protos';
import {
  ALLOWED_ASSET_EXTENSIONS,
  ASSET_DIRNAME,
  MAX_ASSET_FOLDER_SIZE_BYTES,
  MAX_ASSET_GIF_SIZE,
  MAX_ASSET_NON_GIF_SIZE,
  prettyPrintSize,
} from '@devvit/shared-types/Assets.js';
import { StringUtil } from '@devvit/shared-types/StringUtil.js';
import { DevvitVersion, VersionBumpType } from '@devvit/shared-types/Version.js';
import {
  ACTORS_DIR_LEGACY,
  ACTOR_SRC_DIR,
  ACTOR_SRC_PRIMARY_NAME,
  ASSET_HASHING_ALGO,
  MAX_ALLOWED_SUBSCRIBER_COUNT,
} from '@devvit/shared-types/constants.js';
import { APP_SLUG_BASE_MAX_LENGTH, makeSlug, sluggable } from '@devvit/shared-types/slug.js';
import { Flags, ux } from '@oclif/core';
import type { FlagInput } from '@oclif/core/lib/interfaces/parser.js';
import chalk from 'chalk';
import { createHash } from 'crypto';
import inquirer from 'inquirer';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { default as glob, default as tinyglob } from 'tiny-glob';
import { TwirpError, TwirpErrorCode } from 'twirp-ts';
import { MY_PORTAL_ENABLED } from '../lib/config.js';
import { isCurrentUserEmployee } from '../lib/http/gql.js';
import { Bundler } from '../util/Bundler.js';
import { getCaptcha } from '../util/captcha.js';
import { createAppClient, createAppVersionClient } from '../util/clientGenerators.js';
import { ProjectCommand } from '../util/commands/ProjectCommand.js';
import { DEVVIT_PORTAL_URL } from '../util/config.js';
import type { DevvitConfig } from '../util/devvitConfig.js';
import { updateDevvitConfig } from '../util/devvitConfig.js';
import { dirExists } from '../util/files.js';
import { readPackageJSON } from '../util/package-managers/package-util.js';
import { handleTwirpError } from '../util/twirp-error-handler.js';

type MediaSignatureWithContents = MediaSignature & {
  contents: Uint8Array;
};

export default class Upload extends ProjectCommand {
  static override description = `Upload the app to the App Directory. Uploaded apps are only visible to you (the app owner) and can only be installed to a small test subreddit with less than ${MAX_ALLOWED_SUBSCRIBER_COUNT} subscribers`;

  static override flags: FlagInput = {
    bump: Flags.custom<VersionBumpType>({
      name: 'bump',
      description: 'Type of version bump (major|minor|patch|prerelease)',
      required: false,
      options: [
        VersionBumpType.Major,
        VersionBumpType.Minor,
        VersionBumpType.Patch,
        VersionBumpType.Prerelease,
      ],
    })(),
    'employee-update': Flags.boolean({
      name: 'employee-update',
      description:
        "I'm an employee and I want to update someone else's app. (This will only work if you're an employee.)",
      required: false,
      hidden: true,
    }),
    justDoIt: Flags.boolean({
      name: 'justDoIt',
      description: "Don't ask any questions, just use defaults & continue. (Useful for testing.)",
      required: false,
      hidden: true,
    }),
    disableTypecheck: Flags.boolean({
      char: 't',
      description: 'Disable typechecking before uploading',
      default: false,
      hidden: true,
    }),
    copyPaste: Flags.boolean({
      name: 'copyPaste',
      description: 'Copy-paste the auth code instead of opening a browser',
      default: false,
    }),
  };

  readonly appClient = createAppClient(this);
  readonly appVersionClient = createAppVersionClient(this);

  async run(): Promise<void> {
    const token = await this.getAccessTokenAndLoginIfNeeded();
    const username = await this.getUserDisplayName(token);

    await this.checkDevvitTermsAndConditions();

    const projectConfig = await this.getProjectConfig();
    const { flags } = await this.parse(Upload);

    // for backwards compatibility, we'll use the app's name as the slug to
    // check if it already exists
    const appName = projectConfig.slug ?? projectConfig.name;
    if (appName == null) {
      this.error("The app's devvit.yaml is misconfigured. It must have at least a 'name' field.");
    }

    let appInfo: FullAppInfo | undefined = await this.getAppBySlug(appName);

    if (!flags.justDoIt) {
      // If we're not just doing it, check and make sure there's a chance our
      // build will succeed.
      if (
        !fs.existsSync(path.join(this.projectRoot, '.pnp.cjs')) &&
        !(await this.#canImportPublicAPI())
      ) {
        this.error(
          `It looks like you don't have dependencies installed. Please run 'npm install' (or yarn, if you're using yarn) and try again.`
        );
      }
    }

    let shouldCreateNewApp = false;
    if (appInfo?.app?.owner?.displayName !== username) {
      shouldCreateNewApp = true;
      // Unless...
      if (flags['employee-update'] || flags.justDoIt) {
        const isEmployee = await isCurrentUserEmployee(token);
        if (!isEmployee) {
          this.error(`You're not an employee, so you can't update someone else's app.`);
        }
        // Else, we're an employee, so we can update someone else's app
        this.warn(`Overriding ownership check because you're an employee and told me to!`);
        shouldCreateNewApp = false;
      }
    }

    let didVerificationBuild = false;
    if (shouldCreateNewApp || !appInfo) {
      // If we're creating a new app, or if we couldn't find the app
      // bundle the app now, to ensure it builds before we potentially create an app
      ux.action.start('Verifying app builds...');
      await this.bundleActors(username, projectConfig.version, !flags.disableTypecheck);
      ux.action.stop('✅');
      didVerificationBuild = true;

      appInfo = await this.createNewApp(projectConfig, flags.copyPaste, flags.justDoIt);
    }

    // Now, create a new version, probably prompting for the new version number
    const version = await this.getNextVersion(appInfo, flags.bump, !flags.justDoIt);
    ux.action.start(didVerificationBuild ? 'Rebuilding for first upload...' : 'Building...');
    const bundles = await this.bundleActors(username, version.toString(), !flags.disableTypecheck);
    ux.action.stop('✅');
    await this.createVersion(appInfo, version, bundles, VersionVisibility.PRIVATE);
    this.log(
      `\n✨ Visit ${chalk.cyan.bold(
        `${DEVVIT_PORTAL_URL}/apps/${appInfo.app?.slug}`
      )} to view your app!`
    );

    process.exit();
  }

  #canImportPublicAPI(): Promise<boolean> {
    // Run a node command in the project directory to check if we can import public-api
    return new Promise<boolean>((resolve, reject) => {
      const checkImportCommand = `node --input-type=module -e "await import('@devvit/public-api')"`;
      // Run this as a child process
      const process = exec(checkImportCommand, { cwd: this.projectRoot }, (error) => {
        // If there was an error creating the child process, reject the promise
        if (error) {
          reject(error);
        }
      });
      process.on('exit', (code) => {
        resolve(code === 0);
      });
    });
  }

  async #promptNameUntilNotTaken(appName: string | undefined): Promise<string> {
    for (;;) {
      const rsp = await inquirer.prompt([
        {
          default: appName,
          name: 'appName',
          type: 'input',
          message: 'Pick a name for your app:',
          validate: async (input: string) => {
            if (!sluggable(input)) {
              return `The name of your app must be between 3 and ${APP_SLUG_BASE_MAX_LENGTH} characters long, and contains only alphanumeric characters, spaces, and dashes.`;
            }
            return true;
          },
          filter: (input: string) => {
            return makeSlug(input.trim().toLowerCase());
          },
        },
      ]);
      appName = rsp.appName;
      if (appName) {
        const isAvailableResponse = await this.#checkAppNameAvailability(appName);
        if (!isAvailableResponse.exists) {
          // Doesn't exist, we're good
          return appName;
        }
        this.warn(`The app name "${appName}" is unavailable.`);
        if (isAvailableResponse.suggestions.length > 0) {
          this.log(
            `Here's some suggestions:\n  * ${isAvailableResponse.suggestions.join('\n  * ')}`
          );
          appName = isAvailableResponse.suggestions[0];
        }
      }
    }
  }

  async createNewApp(
    projectConfig: DevvitConfig,
    copyPaste: boolean,
    justDoIt: boolean
  ): Promise<FullAppInfo> {
    projectConfig.name = await this.#promptNameUntilNotTaken(
      sluggable(projectConfig.name) ? makeSlug(projectConfig.name) : undefined
    );
    const description = await this.#getAppDescription();
    const isNsfw = justDoIt ? false : await this.#promptForNSFW();
    const categories: Categories[] = []; // TODO: should prompt in the future

    let version = projectConfig.version;
    // if the config version is larger than 0.0.0 when creating a new App
    if (DevvitVersion.fromString(version).newerThan(new DevvitVersion(0, 0, 0))) {
      this.warn(
        `The version number in your devvit.yaml is larger than "0.0.0". The first published version of your app must be "0.0.0".
          We use the name of your app to index published versions, so unless you want to publish a "new" app, don't change the "name" field of devvit.yaml`
      );
      if (!justDoIt)
        version = (
          await inquirer.prompt([
            {
              name: 'overwriteVersion',
              type: 'confirm',
              message: `Would you like us to overwrite the "version" field of devvit.yaml to "0.0.0"?`,
            },
          ])
        ).overwriteVersion;
      if (!justDoIt && !version) {
        this.error(`Please manually change the version back to "0.0.0"`);
      } else {
        version = '0.0.0';
        await updateDevvitConfig(this.projectRoot, { version });
      }
    }

    const appCreationRequest = AppCreationRequest.fromPartial({
      name: projectConfig.name,
      description: description ?? '',
      isNsfw,
      categories,
      captcha: '',
    });

    // Captcha not required in snoodev, but required in prod
    if (!MY_PORTAL_ENABLED) {
      appCreationRequest.captcha = await getCaptcha({ copyPaste });
    }

    try {
      ux.action.start('Creating app...');
      // let's eliminate the "slug" field and just update the "name" directly
      const newApp = await this.appClient.Create(appCreationRequest);
      await updateDevvitConfig(this.projectRoot, {
        name: newApp.slug,
        version,
      });
      ux.action.stop('Successfully created your app in Reddit!');
      return FullAppInfo.fromPartial({
        app: newApp,
        // There's no versions, we just made it :)
      });
    } catch (err) {
      if (err instanceof TwirpError && err.code === TwirpErrorCode.AlreadyExists) {
        this.error(
          `An app account with the name "${projectConfig.name}" already exists. Please change the "name" field of devvit.yaml and try again.`
        );
      } else {
        this.error(StringUtil.caughtToString(err));
      }
    }
  }

  async #checkAppNameAvailability(name: string): Promise<AppAccountExistsResponse> {
    const [appAccountExistsRes, appExistsRes] = await Promise.all([
      this.appClient.AppAccountExists({ accountName: name }),
      this.appClient.Exists({ slug: name }),
    ]);

    return {
      exists: appAccountExistsRes.exists || appExistsRes.exists,
      suggestions: appAccountExistsRes.suggestions,
    };
  }

  async #getAppDescription(): Promise<string | undefined> {
    return (await readPackageJSON(this.projectRoot)).description?.substring(0, 200);
  }

  async #promptForNSFW(): Promise<boolean> {
    return (
      await inquirer.prompt<{ isNSFW: boolean }>([
        {
          name: 'isNSFW',
          message: 'Is the app NSFW?',
          type: 'confirm',
          default: false,
        },
      ])
    ).isNSFW;
  }

  /**
   * returns undefined if the app is not found, or if the user doesn't have permission to view the app
   */
  async getAppBySlug(slug: string): Promise<FullAppInfo | undefined> {
    try {
      const appInfo = await this.appClient.GetBySlug(GetAppBySlugRequest.fromPartial({ slug }));
      return appInfo.app ? appInfo : undefined;
    } catch (err) {
      if (err instanceof TwirpError) {
        if (err.code === TwirpErrorCode.NotFound) {
          return undefined;
        }
        if (err.code === TwirpErrorCode.PermissionDenied) {
          return undefined;
        }
      }
      this.error(StringUtil.caughtToString(err));
    }
  }

  async getNextVersion(
    appInfo: FullAppInfo,
    bump: VersionBumpType | undefined,
    prompt: boolean
  ): Promise<DevvitVersion> {
    // Sync up our local and remote versions
    const appVersion = await this.#syncPublishedAndLocalVersions(appInfo, !prompt);

    // Get how much we want to bump the version number by
    if (bump) {
      appVersion.bumpVersion(bump);
    } else {
      // Automatically bump the version
      const latestStoredVersion = this.getLatestPublishedVersion(appInfo.versions);
      if (appVersion.isEqual(latestStoredVersion)) {
        appVersion.bumpVersion(VersionBumpType.Patch);
        this.log('Automatically bumped app version to:', appVersion.toString());
      }
    }

    await updateDevvitConfig(this.projectRoot, {
      version: appVersion.toString(),
    });

    return appVersion;
  }

  async createVersion(
    appInfo: FullAppInfo,
    appVersion: DevvitVersion,
    bundles: Bundle[],
    visibility: VersionVisibility
  ): Promise<AppVersionInfo> {
    // Get the 'about' text
    let about = '';
    const readmePath = (await glob('*.md', { cwd: this.projectRoot })).filter(
      (file) => file.toLowerCase() === 'readme.md'
    );
    if (readmePath.length > 1) {
      this.log("Found multiple 'readme.md'-looking files - going with " + readmePath[0]);
    }
    if (readmePath.length >= 1) {
      about = await fsp.readFile(path.join(this.projectRoot, readmePath[0]), 'utf-8');
    } else {
      this.log(
        "Couldn't find README.md, so not setting an 'about' for this app version (you can update this later)"
      );
    }

    // Sync and upload assets
    const assetNamesToIDs = await this.#syncAssets();

    // Dump these in the assets fields of the bundles
    for (const bundle of bundles) {
      bundle.assetIds = assetNamesToIDs;
    }

    // Actually create the app version
    const appVersionCreationRequest = AppVersionCreationRequest.fromPartial({
      appId: appInfo.app?.id ?? '',
      visibility,
      about,
      validInstallTypes: [InstallationType.SUBREDDIT], // TODO: Once we have user/global installs, we'll need to ask about this.
      majorVersion: appVersion.major,
      minorVersion: appVersion.minor,
      patchVersion: appVersion.patch,
      prereleaseVersion: appVersion.prerelease,
      actorBundles: bundles,
    });

    ux.action.start(`Uploading new version "${appVersion.toString()}" to Reddit...`);
    try {
      const appVersionInfo = await this.appVersionClient.Create(appVersionCreationRequest);
      ux.action.stop(`✅`);

      return appVersionInfo;
    } catch (error) {
      return handleTwirpError(error, (message: string) => this.error(message));
    }
  }

  async bundleActors(
    username: string,
    version: string,
    typecheck: boolean = true
  ): Promise<Bundle[]> {
    const bundler = new Bundler(typecheck);

    try {
      const srcDirPath = path.join(this.projectRoot, ACTOR_SRC_DIR);

      if (await dirExists(srcDirPath)) {
        /**
         * For Apps with `./src/*`
         */
        return [
          await bundler.bundle(
            srcDirPath,
            ActorSpec.fromPartial({
              name: ACTOR_SRC_PRIMARY_NAME,
              owner: username,
              version: version,
            })
          ),
        ];
      } else {
        /**
         * For Apps with `./actors/*`
         */
        const actorDirs = await glob(path.join(this.projectRoot, ACTORS_DIR_LEGACY, '*'));

        return await Promise.all(
          actorDirs.map((actorDir) =>
            bundler.bundle(
              actorDir,
              ActorSpec.fromPartial({
                name: actorDir.split(path.sep).at(-1) ?? '',
                owner: username,
                version: version,
              })
            )
          )
        );
      }
    } catch (err) {
      this.error(StringUtil.caughtToString(err));
    }
  }

  getLatestPublishedVersion(versions: AppVersionInfo[]): DevvitVersion {
    const versionsSorted = versions
      .map(
        (v) =>
          new DevvitVersion(v.majorVersion, v.minorVersion, v.patchVersion, v.prereleaseVersion)
      )
      .sort((lhs, rhs) => lhs.compare(rhs));

    return versionsSorted.at(-1) ?? new DevvitVersion(0, 0, 0);
  }

  async #syncPublishedAndLocalVersions(
    appInfo: FullAppInfo,
    justDoIt: boolean | undefined
  ): Promise<DevvitVersion> {
    const latestStoredVersion = this.getLatestPublishedVersion(appInfo.versions);
    const devvitYamlVersion = DevvitVersion.fromString((await this.getProjectConfig()).version);

    if (!latestStoredVersion.isEqual(devvitYamlVersion)) {
      this.warn(
        `The latest published version on Reddit is "${latestStoredVersion.toString()}". The version number in your local devvit.yaml is "${devvitYamlVersion.toString()}"`
      );
      const overwriteVersion =
        justDoIt ||
        (
          await inquirer.prompt([
            {
              name: 'overwriteVersion',
              type: 'confirm',
              message:
                'Allow overwriting local devvit.yaml to match versions with the latest published version on Reddit?',
            },
          ])
        ).overwriteVersion;
      if (!overwriteVersion) {
        this.error(
          `Aborting. Make sure to manually set the version field of devvit.yaml to "${latestStoredVersion.toString()}" to match the latest published version already on Reddit.`
        );
      }
      await updateDevvitConfig(this.projectRoot, {
        version: latestStoredVersion.toString(),
      });
    }

    return latestStoredVersion.clone();
  }

  /**
   * Checks if there are any new assets to upload, and if there are, uploads them.
   * Returns a map of asset names to their asset IDs.
   * Can throw an exception if the app's assets exceed our limits.
   */
  async #syncAssets(): Promise<Record<string, string>> {
    const assetNamesToIDs: Record<string, string> = {};
    const config = await this.getProjectConfig();
    const appAssets = await this.#getAssets();

    // Return early if no assets
    if (appAssets.length === 0) {
      return {};
    }

    // Do some rough client-side asset verification - it'll be more robust on
    // the server side of things, but let's help "honest" users out early
    const appAssetsTotalSize = appAssets.reduce((sum, a) => sum + a.size, 0);
    if (appAssetsTotalSize > MAX_ASSET_FOLDER_SIZE_BYTES) {
      this.error(
        `Your assets folder is too big - you've got ${prettyPrintSize(
          appAssetsTotalSize
        )} of assets, which is more than the ${prettyPrintSize(
          MAX_ASSET_FOLDER_SIZE_BYTES
        )} total allowed.`
      );
    }
    for (const asset of appAssets) {
      if (asset.filePath.endsWith('.gif') && asset.size > MAX_ASSET_GIF_SIZE) {
        this.error(
          `Asset ${asset.filePath} is too large - gifs can't be more than ${prettyPrintSize(
            MAX_ASSET_GIF_SIZE
          )}.`
        );
      }
      if (asset.size > MAX_ASSET_NON_GIF_SIZE) {
        this.error(
          `Asset ${asset.filePath} is too large - images can't be more than ${prettyPrintSize(
            MAX_ASSET_NON_GIF_SIZE
          )}.`
        );
      }
    }

    ux.action.start(`Checking for new assets to upload...`);

    // Check if this media exists or not
    const res = await this.appClient.CheckIfMediaExists({
      id: undefined,
      slug: config.name,
      signatures: appAssets.map((a) => ({
        size: a.size,
        hash: a.hash,
        filePath: a.filePath,
      })),
    });

    // For everything that already exists, add relevant entries to the return map
    res.statuses
      .filter((status) => !status.isNew)
      .forEach((status) => {
        assetNamesToIDs[status.filePath] = status.existingMediaId!;
      });

    // For everything that's new, we'll need to upload them
    const filesNeedingNewUpload = res.statuses
      .filter((status) => status.isNew)
      .map((status) => {
        const asset = appAssets.find((asset) => asset.filePath === status.filePath);
        if (!asset) {
          throw new Error(
            `Backend returned new asset with path ${status.filePath} that we don't know about..?`
          );
        }
        return asset;
      });

    ux.action.stop(
      `Found ${filesNeedingNewUpload.length} new asset${
        filesNeedingNewUpload.length === 1 ? '' : 's'
      }.`
    );

    if (filesNeedingNewUpload.length === 0) {
      // Nothing to upload - return early
      return assetNamesToIDs;
    }

    // Upload everything, giving back pairs of the assets & their upload response
    ux.action.start(`Uploading new assets...`);
    const uploadResults = await Promise.all(
      filesNeedingNewUpload.map(async (f) => {
        return [
          f,
          await this.appClient.UploadNewMedia(
            UploadNewMediaRequest.fromPartial({
              slug: config.name,
              size: f.size,
              hash: f.hash,
              contents: f.contents,
            })
          ),
        ] as [MediaSignatureWithContents, UploadNewMediaResponse];
      })
    );
    ux.action.stop(`New assets uploaded.`);

    // Update our asset name to ID map with the new uploads
    for (const [asset, resp] of uploadResults) {
      assetNamesToIDs[asset.filePath] = resp.assetId;
    }

    return assetNamesToIDs;
  }

  async #getAssets(): Promise<MediaSignatureWithContents[]> {
    if (!(await dirExists(path.join(this.projectRoot, ASSET_DIRNAME)))) {
      // Return early if there isn't an assets directory
      return [];
    }

    const assetsPath = path.join(this.projectRoot, ASSET_DIRNAME);
    const assetsGlob = path
      .join(assetsPath, '**', '*')
      // Note: tiny-glob *always* uses `/` as its path separator, even on Windows, so we need to
      // replace whatever the system path separator is with `/`
      .replaceAll(path.sep, '/');
    const assets = (
      await tinyglob(assetsGlob, {
        filesOnly: true,
        absolute: true,
      })
    ).filter((asset) =>
      // Do a quick filter to get rid of any non-image-looking assets
      ALLOWED_ASSET_EXTENSIONS.includes(path.extname(asset))
    );
    return await Promise.all(
      assets.map(async (asset) => {
        const filename = path.relative(assetsPath, asset).replaceAll(path.sep, '/');
        const file = await fsp.readFile(asset);
        const size = Buffer.byteLength(file);
        const contents = new Uint8Array(file);

        const hash = createHash(ASSET_HASHING_ALGO).update(file).digest('hex');
        return {
          filePath: filename,
          size,
          hash,
          contents,
        };
      })
    );
  }
}
