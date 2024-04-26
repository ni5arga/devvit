import type { Context, KVStore } from '@devvit/public-api';
import type { GameSubscription } from './sports/Sports.js';

const MAX_SUBSCRIPTIONS = 10;
const ALL_SUBSCRIPTIONS_KEY = 'subscriptions';

/**
 * Look up and return every subscription from the kvStore. The objects stored
 * there are the keys stored by calls to addSubscription().
 * @param ctx Context object with kvStore
 * @param key The optional subscription key to look up. If provided, return only
 * those subscriptions matching this key.
 * @returns Promise<string[]> list of JSON-encoded subscription objects or nothing
 */
export async function getSubscriptions(kvStore: KVStore, key?: string): Promise<string[]> {
  try {
    const subscriptions: string[] | undefined = await kvStore.get(ALL_SUBSCRIPTIONS_KEY);
    if (subscriptions === undefined) {
      return [];
    }
    return subscriptions.filter((sub) => key === undefined || key === sub);
  } catch (e: unknown) {
    console.log('Error during subscriptions fetch:', e);
  }
  return [];
}

/**
 * Attempts to add a subscription to the list of all active subscriptions. This
 * will return true if successful and false if an error occurs or the subscription
 * limit is reached. In the latter case, a subscription must first be removed with
 * removeSubscription() before another can be added. If a subscription with
 * the given key already exists, this will return true without performing
 * any action.
 * @param ctx Context object with kvStore
 * @param key The subscription key to add to the list of active subscriptions
 * @returns boolean whether or not the subscription was successfully added
 */
export async function addSubscription(ctx: Context, key: string): Promise<boolean> {
  const subscriptions: string[] = await getSubscriptions(ctx.kvStore);
  if (subscriptions.includes(key)) {
    console.log(`subscription ${key} is already active`);
    return true;
  }
  console.log(`adding subscription ${key}`);
  if (subscriptions.length >= MAX_SUBSCRIPTIONS) {
    ctx.ui.showToast('Post Failed - Too many active subscriptions.');
    return false;
  }
  subscriptions.push(key);
  try {
    await ctx.kvStore.put(ALL_SUBSCRIPTIONS_KEY, subscriptions);
  } catch (e: unknown) {
    console.log('Error during subscriptions store: ' + e);
    return false;
  }
  return true;
}

/**
 * Attempts to remove the given subscription key from the kvStore. If such a
 * key does not exist, this returns true.
 * @param ctx Context object with kvStore
 * @param key The subscription key to remove
 * @returns boolean whether the operation succeeded
 */
export async function removeSubscription(kvStore: KVStore, key: string): Promise<boolean> {
  const gameSubscription: GameSubscription = JSON.parse(key);
  const subscriptionsStrings: string[] = await getSubscriptions(kvStore);

  const subscriptions = subscriptionsStrings.flatMap((subscriptionString) => {
    const gameSubscription: GameSubscription = JSON.parse(subscriptionString);
    return gameSubscription;
  });

  const index = subscriptions.findIndex((subs) => {
    return (
      subs.league === gameSubscription.league &&
      subs.service === gameSubscription.service &&
      subs.eventId === gameSubscription.eventId &&
      subs.postId === gameSubscription.postId
    );
  });

  if (index < 0) {
    return true;
  }
  subscriptionsStrings.splice(index, 1);
  try {
    await kvStore.put(ALL_SUBSCRIPTIONS_KEY, subscriptionsStrings);
  } catch (e: unknown) {
    console.log('Error during subscriptions store:', e);
    return false;
  }
  console.log('Removed subscription:', key);
  return true;
}
