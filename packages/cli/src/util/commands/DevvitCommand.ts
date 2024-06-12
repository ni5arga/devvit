import { Empty } from '@devvit/protos';
import type { T2ID } from '@devvit/shared-types/tid.js';
import { Command, Flags } from '@oclif/core';
import type { FlagInput } from '@oclif/core/lib/interfaces/parser.js';
import { parse } from '@oclif/core/lib/parser/index.js';
import open from 'open';
import { NodeFSAuthenticationPlugin } from '../../lib/auth/NodeFSAuthenticationPlugin.js';
import type { StoredToken } from '../../lib/auth/StoredToken.js';
import { DOT_DEVVIT_DIR_FILENAME } from '../../lib/config.js';
import { DEVVIT_CONFIG_FILE, readDevvitConfig } from '../../util/devvitConfig.js';
import { findProjectRoot } from '../../util/project-util.js';
import { AUTH_CONFIG } from '../auth.js';
import { createWaitlistClient } from '../clientGenerators.js';
import { DEVVIT_PORTAL_URL } from '../config.js';
import { readLine } from '../input-util.js';
import { fetchUserDisplayName, fetchUserT2Id } from '../r2Api/user.js';
import { sleep } from '../sleep.js';

/**
 * Note: we have to return `Promise<string>` here rather than just `string`
 * The official documentation has an error and doesn't match the TS declarations for this method
 *
 * @see https://oclif.io/docs/args/
 */
export const toLowerCaseArgParser = async (input: string): Promise<string> => input.toLowerCase();

export abstract class DevvitCommand extends Command {
  protected _authSvc: NodeFSAuthenticationPlugin | undefined;
  #configFile: string | undefined;

  static override baseFlags: FlagInput = {
    config: Flags.string({
      name: 'config',
      description: 'path to devvit config file',
      default: DEVVIT_CONFIG_FILE,
    }),
  };

  public get configFile(): string {
    return this.#configFile ?? DEVVIT_CONFIG_FILE;
  }

  protected override async init(): Promise<void> {
    await super.init();

    // to-do: avoid subclassing and compose instead. subclasses cause bugs
    //        because of all the inherited behavior wanted or not, require
    //        understanding the entire hierarchy top to bottom (and left to
    //        right for a base class like this), and need crazy hacks like
    //        below.
    const baseFlags = Object.keys(DevvitCommand.baseFlags).map((flag) => `--${flag}`);
    const baseArgv = this.argv.filter(
      (arg) => !arg.startsWith('--') || baseFlags.some((flag) => arg.startsWith(flag))
    );
    // call parse() instead of this.parse() which only knows of
    // DevvitCommand.baseFlags.
    const { flags } = await parse(baseArgv, {
      strict: false,
      flags: DevvitCommand.baseFlags,
    });

    this.#configFile = flags.config;
    if (this.#configFile !== DEVVIT_CONFIG_FILE) {
      this.log(`Using custom config file: ${this.#configFile}`);
    }
  }

  get isOauthSvcInitd(): boolean {
    return this._authSvc != null;
  }

  get oauthSvc(): NodeFSAuthenticationPlugin {
    if (!this._authSvc) {
      this._authSvc = new NodeFSAuthenticationPlugin({
        dotDevvitDir: DOT_DEVVIT_DIR_FILENAME,
        auth: AUTH_CONFIG,
      });
    }
    return this._authSvc;
  }

  getAccessTokenAndLoginIfNeeded = async (copyPaste?: boolean): Promise<StoredToken> => {
    if (copyPaste) return await this.oauthSvc.loginViaCopyPaste();
    return await this.oauthSvc.Authenticate();
  };

  getAccessToken = async (): Promise<StoredToken | undefined> => {
    try {
      const tokenInfo = await this.oauthSvc.authTokenStore.readFSToken();
      if (!tokenInfo || !tokenInfo.token.hasScopes(AUTH_CONFIG.scopes)) {
        return undefined;
      }
      if (tokenInfo.token.isFresh()) {
        return tokenInfo.token;
      }
      return (
        await this.oauthSvc.refreshStoredToken(
          tokenInfo.token.refreshToken,
          Boolean(tokenInfo.copyPaste)
        )
      ).token;
    } catch {
      // probably logged out
      return;
    }
  };

  readonly waitlistClient = createWaitlistClient(this);
  protected ensureDeveloperAccountExists = async (): Promise<void> => {
    try {
      await this.waitlistClient.EnsureDeveloperAccountExists(Empty.fromPartial({}));
    } catch (err) {
      this.error(`Error creating developer account: ${err}`);
    }
  };

  protected checkDevvitTermsAndConditions = async (): Promise<void> => {
    await this.ensureDeveloperAccountExists();

    const { acceptedTermsVersion, currentTermsVersion } =
      await this.waitlistClient.GetCurrentUserStatus(Empty.fromPartial({}));

    const termsUrl = `${DEVVIT_PORTAL_URL}/terms`;
    if (acceptedTermsVersion < currentTermsVersion) {
      this.log('Please accept our Terms and Conditions before proceeding:');
      this.log(`${termsUrl} (press enter to open, control-c to quit)`);
      await readLine();
      try {
        await open(termsUrl);
      } catch {
        this.error('An error occurred when opening Terms and Conditions');
      }
      // Waiting is necessary, for some reason, or the browser doesn't open!
      // See issue: https://github.com/sindresorhus/open/issues/189
      await sleep(5000);
      process.exit();
    }
  };

  protected async checkIfUserLoggedIn(): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) {
      this.error('Not currently logged in. Try `devvit login` first');
    }
  }

  /**
   * @description Get the user's display name from the stored token.
   */
  protected async getUserDisplayName(token: StoredToken): Promise<string> {
    const res = await fetchUserDisplayName(token);
    if (!res.ok) {
      this.error(`${res.error}. Try again or re-login with \`devvit login\`.`);
    }
    return res.value;
  }

  /**
   * @description Get the user's t2 id from the stored token.
   */
  protected async getUserT2Id(token: StoredToken): Promise<T2ID> {
    const res = await fetchUserT2Id(token);
    if (!res.ok) {
      this.error(`${res.error}. Try again or re-login with \`devvit login\`.`);
    }
    return res.value;
  }

  protected async inferAppNameFromProject(): Promise<string> {
    const projectRoot = await findProjectRoot(this.configFile);
    if (projectRoot == null) {
      this.error(`You must specify an app name or run this command from within a project.`);
    }
    const devvitConfig = await readDevvitConfig(projectRoot, this.configFile);

    return devvitConfig.name;
  }

  /**
   * @description Handle resolving the appname@version for the following cases
   *
   * Case 1: devvit <publish|install> <app-name>@<version>  - can be run anywhere
   * Case 1: devvit <publish|install> <app-name>            - can be run anywhere
   * Case 3: devvit <publish|install> <version>             - must be in project directory
   * Case 2: devvit <publish|install>                       - must be in project directory
   */
  protected async inferAppNameAndVersion(appWithVersion: string | undefined): Promise<string> {
    if (appWithVersion && !appWithVersion.startsWith('@')) {
      // assume it is the form <app-name>@<version> or <app-name>
      return appWithVersion;
    }

    const projectRoot = await findProjectRoot(this.configFile);
    if (projectRoot == null) {
      this.error(`You must specify an app name or run this command from within a project.`);
    }
    const devvitConfig = await readDevvitConfig(projectRoot, this.configFile);

    if (!appWithVersion) {
      // getInfoForSlugString is called after this which will default to latest version so we don't need to return the
      // version here
      return devvitConfig.name;
    }
    if (appWithVersion.startsWith('@')) {
      return `${devvitConfig.name}${appWithVersion}`;
    }

    return appWithVersion;
  }
}
