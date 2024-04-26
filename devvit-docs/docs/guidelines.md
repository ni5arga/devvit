# Guidelines

The Reddit Developer Platform gives developers unprecedented ability to customize the core Reddit
experience. Our guidelines are designed to protect and enhance the redditor user experience.

## Reddit Policies apply

Keep in mind that your app must comply with all applicable Reddit policies, which include the Reddit [Developer Terms](https://www.redditinc.com/policies/developer-terms) and [Data API Terms](https://www.redditinc.com/policies/data-api-terms), as well as our [User Agreement](https://www.redditinc.com/policies/), [Privacy Policy](https://www.reddit.com/policies/privacy-policy), [Content Policy](https://www.redditinc.com/policies/content-policy) and [Advertising Policy](https://redditinc.force.com/helpcenter/s/article/Reddit-Advertising-Policy-Restricted-Advertisements) (“Reddit Terms & Policies”). Based on these policies, Reddit may review your app prior to hosting it, and/or take enforcement actions ranging from temporary suspension to permanent removal of your app, blocking your access to Reddit's Developer Platform, or suspending your developer account.

## Devvitquette

Do:

- Remember the human, community, and your fellow devs
  - Build with the ecosystem in mind - provide discrete functionality and always try to add value
  - Be reliable - maintain work that communities rely on, communicate when you cannot, and make it easy to contact you for support
  - Provide transparency - use clear naming and descriptions that accurately describe your app's functionality, purpose, and data practices
  - Respect Redditors' data and privacy - make sure you get consent and appropriate permissions before processing data, or taking any actions (automated or not) on Redditors' behalf; and only use the necessary data for your app's stated functionality
  - make sure your app complies with our [moderator code of conduct](https://www.redditinc.com/policies/moderator-code-of-conduct)
- Facilitate successful deployment
  - Consider inclusion/exclusion lists if your app is not installed on the subreddit level
  - Test your app locally and in sandbox subreddits when applicable
- Let us know if your app is compromised (e.g., data breach, unauthorized access)

Don’t:

- Break any rule outlined in Reddit’s Terms & Policies - make sure your app doesn't:
  - Facilitate, promote nor amplify any form of harassment, violence or hateful activities
  - Engage in nor enable the manipulation of Reddit's features (e.g., voting, karma) or the circumvention of safety mechanisms (e.g., user blocking, account bans)
  - Promote deceptive content (e.g., spam, malware) nor facilitate adverse actions that may interfere with the normal use of Reddit (e.g., introducing malicious code or programs that violate Reddit Terms & Policies)
  - Mislead Redditors about your relationship with Reddit or any other person or entity
  - Infringe on others' intellectual property rights, nor make it easier to violate others' privacy
  - Enable the distribution of harmful content or the facilitation of illegal or legally restricted activities
  - Expose Redditors to graphic, sexually-explicit, or offensive content without proper labeling
  - Allow others to break any of the rules in Reddit Terms & Policies
- Write programs that respond to generic words or event types
- Create an app or functionality for use in or that targets services in a prohibited or regulated industry such as (but not limited to) gambling, healthcare, financial and cryptocurrency products and services, political advertisement, alcohol, recreational drugs, or any other restricted category listed in the [Reddit Advertising Policy](https://redditinc.force.com/helpcenter/s/article/Reddit-Advertising-Policy-Restricted-Advertisements)
- Process account data to infer Redditors' personal characteristics, such as racial or ethnic origin, political opinions, religious or philosophical beliefs, union membership, genetics or biometrics, health, sex life, or sexual orientation
- Gather intelligence nor attempt to track Redditors or Reddit content for the purpose of surveillance, and/or to provide that information to governments or other entities conducting surveillance
- Intrude on Redditors' privacy and autonomy in spaces your app isn't authorized to access or moderate
- Request that Redditors share their login credentials or any other personal information to access or complete any action through your app
- Attempt to publish an app targeting anyone under 13 -- Redditors must all be over the age of 13 to use the platform!
- Attempt to circumvent any safety or security enforcement measures Reddit may have taken, including against your app

## Content deletion policy

You are required to remove any user content that has been deleted from Reddit from your Devvit app. We provide access to post and comment delete events via [triggers](https://developers.reddit.com/docs/event_triggers) to help facilitate this.

On `PostDelete` and `CommentDelete` event triggers, you must delete all content related to the post and/or comment (for example, title, body, embedded URLs, etc.) from your app. This includes data that is in the Redis/KVstore and data sent to an external service. Metadata required for contextualizing related content (for example, post or comment ID, createdAt, etc.) may be retained.

When a user account is deleted, the related user ID (t2\_\*) must be completely removed from your hosted datastores (e.g. Redis/KVStore) and any external systems. You must also delete all references to the author-identifying information (i.e. the author ID, name, profile URL, avatar image URL, user flair, etc.) from posts and comments created by that account. You may continue to keep posts and comments created by deleted accounts, provided that the posts and comments have not been explicitly deleted.

To best comply with this policy, we strongly recommend routinely deleting any stored user data and content within 48 hours, including in the kvstore/redis.

Note that retention of content and data that has been deleted–-even if disassociated, de-identified or anonymized–-is a violation of our terms and policies.
