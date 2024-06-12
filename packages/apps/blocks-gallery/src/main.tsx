import type { ContextAPIClients } from '@devvit/public-api';
import { Devvit } from '@devvit/public-api';

import { BlockGallery } from './components/BlockGallery.js';
import { GalleryState } from './state/state.js';

Devvit.debug.emitSnapshots = true;

Devvit.configure({
  redditAPI: true,
});

Devvit.addMenuItem({
  label: 'Blocks Gallery: Create a post',
  location: 'subreddit',
  async onPress(_, { reddit, ui }) {
    const currentSubreddit = await reddit.getCurrentSubreddit();
    await reddit.submitPost({
      title: 'Blocks Gallery',
      subredditName: currentSubreddit.name,
      preview: (
        <vstack alignment={'middle center'} grow>
          <text>Loading blocks gallery</text>
        </vstack>
      ),
    });

    ui.showToast('Posted a blocks gallery!');
  },
});

Devvit.addCustomPostType({
  name: 'Blocks Gallery',
  description: 'Demonstrates the blocks elements',
  height: 'tall',
  render: (renderContext: ContextAPIClients) => {
    const state = new GalleryState(renderContext);
    return <BlockGallery state={state} />;
  },
});

export default Devvit;
