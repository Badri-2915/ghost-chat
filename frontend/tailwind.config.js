/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ghost: {
          50: '#f0f4ff',
          100: '#e0e8ff',
          200: '#c7d4fe',
          300: '#a3b8fc',
          400: '#7a94f9',
          500: '#5a6ff3',
          600: '#4550e7',
          700: '#3840cc',
          800: '#2f36a5',
          900: '#2c3382',
          950: '#1a1e4c',
        },
      },
    },
  },
  plugins: [],
};
