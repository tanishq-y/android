/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        heading: ['DM Sans',  'system-ui', 'sans-serif'],
        body:     ['Inter',   'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#0D9F6F',
          light:   '#E6F7F2',
          dark:    '#097A54',
        },
        surface: '#FFFFFF',
        bg:      '#F7F8FA',
        border:  '#E5E7EB',
        muted:   '#9CA3AF',
        platform: {
          blinkit:   '#0C831F',
          zepto:     '#8025FB',
          instamart: '#FC8019',
          bigbasket: '#84C225',
          jiomart:   '#0089CF',
        },
      },
      borderRadius: {
        card: '12px',
        chip: '24px',
      },
      boxShadow: {
        card:   '0 1px 4px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.05)',
        banner: '0 4px 24px rgba(13,159,111,0.15)',
      },
      maxWidth: {
        content: '1200px',
      },
    },
  },
  plugins: [],
};
