import type { AssetMap } from '@devvit/shared-types/Assets.js';
import { Devvit } from '../../devvit/Devvit.js';

export type GetURLOptions = {
  webview?: boolean | undefined;
};

export class AssetsClient {
  readonly #assetMap: AssetMap = {};
  readonly #webviewAssetMap: AssetMap = {};

  constructor() {
    this.#assetMap = Devvit.assets;
    this.#webviewAssetMap = Devvit.webviewAssets;
  }

  /**
   * Gets the public URLs for an asset.
   * @param assetPath A path, relative to the 'assets/' folder.
   * @param options
   * @returns The public URL for that asset (https://i.redd.it/<id>.<ext>)
   */
  getURL(assetPath: string): string;

  getURL(assetPath: string, options: GetURLOptions | undefined): string;

  /**
   * Gets the public URLs for multiple assets.
   * @param assetPaths An array of paths, relative to the 'assets/' folder.
   * @returns A map of each asset path to its public URL (https://i.redd.it/<id>.<ext>)
   */
  getURL(assetPaths: string[]): AssetMap;

  getURL(assetPaths: string[], options: GetURLOptions | undefined): AssetMap;
  /**
   * Takes one or more asset names, relative to the 'assets/' folder, and returns either the
   * public URL for that one asset, or a map of each asset name to its URL.
   * @param assetPathOrPaths - Either the path you need the public URL for, or an array of paths.
   * @param options
   * @returns Either the public URL for the one asset you asked for, or a map of assets to their URLs.
   */
  getURL(
    assetPathOrPaths: string | string[],
    options?: GetURLOptions | undefined
  ): string | AssetMap {
    if (typeof assetPathOrPaths === 'string') {
      return this.#getURL(assetPathOrPaths, options ?? { webview: false });
    }
    return this.#getURLs(assetPathOrPaths, options ?? { webview: false });
  }

  #getURL(assetPath: string, options: GetURLOptions): string {
    // Has the assetPath already been resolved?
    const localUrl = options.webview ? this.#webviewAssetMap[assetPath] : this.#assetMap[assetPath];
    if (localUrl) {
      return localUrl;
    }

    try {
      // This will throw an exception if it's an invalid URL such as a relative path
      new URL(assetPath);
      // URL is valid
      return assetPath;
    } catch {
      // Not a fully qualified URL, not an asset, return an empty string
      return '';
    }
  }

  #getURLs(assetPaths: string[], options: GetURLOptions): AssetMap {
    const retval: Record<string, string> = {};
    let missingPaths: string[] = [];

    // Try and short circuit using the locally available assets list if possible, keeping a list
    // of all the paths that we couldn't find locally to ask the backend about
    const cache = options.webview ? this.#webviewAssetMap : this.#assetMap;
    if (cache) {
      for (const path of assetPaths) {
        if (cache[path]) {
          retval[path] = cache[path];
        } else {
          try {
            new URL(path);
            retval[path] = path;
          } catch {
            // invalid URL, missing from cache
            missingPaths.push(path);
          }
        }
      }
    } else {
      // No local assets - everything is missing
      missingPaths = assetPaths;
    }

    if (missingPaths.length > 0) {
      throw new Error(
        `The following assets were missing from the assets list: ${missingPaths.join(', ')}`
      );
    }

    return retval;
  }
}
