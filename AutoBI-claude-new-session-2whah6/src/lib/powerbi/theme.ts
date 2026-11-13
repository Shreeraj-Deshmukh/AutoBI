import { CLIENT_THEME as C, PALETTE } from '@/dashboard/format';
// Power BI's built-in "CY23SU04" base theme, as written by Power BI Desktop
// (from Microsoft's sample PBIP: github.com/microsoft/Analysis-Services, MIT licence).
import baseTheme from './themes/CY23SU04.json';
// client logo, shown at the top left of every report page (same file as the app's dashboards)
import logoSvg from '../../../public/brand/sanofi-logo.svg?raw';

export const BASE_THEME_NAME = 'CY23SU04';
export const CUSTOM_THEME_FILE = 'CelestraTheme.json';
export const LOGO_FILE = 'ClientLogo.svg';
export { baseTheme, logoSvg };

const solid = (color: string) => ({ solid: { color } });

/** Exported report look, from the client theme shared with the web dashboard: series palette, white cards with a light border on a grey page. */
export const celestraTheme = {
  name: C.name,
  dataColors: PALETTE,
  foreground: C.ink,
  foregroundNeutralSecondary: C.inkSecondary,
  foregroundNeutralTertiary: '#a3a3a3',
  background: '#ffffff',
  backgroundLight: '#fafafa',
  backgroundNeutral: C.border,
  tableAccent: C.primary,
  good: '#059669',
  neutral: C.muted,
  bad: '#dc2626',
  textClasses: {
    title: { fontFace: 'Segoe UI Semibold', fontSize: 11, color: C.ink },
    label: { fontFace: 'Segoe UI', fontSize: 9, color: C.inkSecondary },
    callout: { fontFace: 'Segoe UI Semibold', fontSize: 22, color: C.ink },
  },
  visualStyles: {
    '*': {
      '*': {
        background: [{ show: true, color: solid('#ffffff'), transparency: 0 }],
        border: [{ show: true, color: solid(C.border), radius: 10 }],
        title: [{ show: true, fontColor: solid(C.ink), fontSize: 11, bold: true }],
        subTitle: [{ fontColor: solid(C.muted), fontSize: 9 }],
      },
    },
    page: { '*': { background: [{ color: solid(C.page), transparency: 0 }] } },
    textbox: { '*': { background: [{ show: false }], border: [{ show: false }] } },
  },
};
