// @ts-check
// Note: type annotations allow type checking and IDEs autocompletion

const { themes } = require('prism-react-renderer');
const lightCodeTheme = themes.github;
const darkCodeTheme = themes.dracula;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Reddit for Developers',
  tagline: 'An app for anything',
  url: 'https://developers.reddit.com',
  baseUrl: process.env.DOCUSAURUS_BASE_URL ?? '/',
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/orangered_icon_devvit_fill.svg',
  markdown: {
    format: 'detect',
  },

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'reddit', // Usually your GitHub org/user name.
  projectName: 'devvit', // Usually your repo name.

  // Even if you don't use internalization, you can use this field to set useful
  // metadata like html lang. For example, if your site is Chinese, you may want
  // to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          routeBasePath: '/', // Serve the docs at the site's root
          sidebarPath: require.resolve('./sidebars.js'),
          lastVersion: '0.10',
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
        gtag: {
          trackingID: 'G-GWE79J8M6R',
          anonymizeIP: true,
        },
      },
    ],
    
  ],
  plugins: [
    
    [
      require.resolve('@cmfcmf/docusaurus-search-local'),
      {
        indexBlog: false,
      },
    ],
  ],
  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      docs: {
        sidebar: {
          autoCollapseCategories: false,
        },
      },
      navbar: {
        logo: {
          alt: 'Reddit for Developers',
          src: 'img/logo.svg',
          href: 'https://developers.reddit.com/',
          target: '_self',
        },
        items: [
          {
            docsPluginId: 'default',
            type: 'docsVersionDropdown',
            position: 'left',
            dropdownActiveClassDisabled: true,
          },
        ],
      },
      footer: {
        links: [
          {
            title: 'More Resources',
            items: [
              {
                label: 'Go to r/Devvit',
                href: 'https://www.reddit.com/r/devvit',
              },
            ],
          },
        ],
        style: 'dark',
        copyright: `Reddit, Inc. © ${new Date().getFullYear()}. Built with Docusaurus.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
        additionalLanguages: ['json'],
      },
      colorMode: {
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },
    }),
};

module.exports = config;
