export type ThemeScheme =
  | "default"
  | "sakura-pink"
  | "ocean-blue"
  | "forest-green"
  | "twilight-violet"
  | "amber-orange"
  | "mint-aqua"
  | "rosewood-red";

export interface ThemeSchemeDefinition {
  id: ThemeScheme;
  labelKey: string;
  descriptionKey: string;
  swatches: [string, string, string];
}

export const DEFAULT_THEME_SCHEME: ThemeScheme = "sakura-pink";

export const THEME_SCHEMES: ThemeSchemeDefinition[] = [
  {
    id: "default",
    labelKey: "settings.themeSchemeDefault",
    descriptionKey: "settings.themeSchemeDefaultHint",
    swatches: ["#d8dee9", "#6b7280", "#475569"],
  },
  {
    id: "sakura-pink",
    labelKey: "settings.themeSchemeSakuraPink",
    descriptionKey: "settings.themeSchemeSakuraPinkHint",
    swatches: ["#f2d9e4", "#c05582", "#9e466e"],
  },
  {
    id: "ocean-blue",
    labelKey: "settings.themeSchemeOceanBlue",
    descriptionKey: "settings.themeSchemeOceanBlueHint",
    swatches: ["#d7e9f7", "#5295d4", "#3476b4"],
  },
  {
    id: "forest-green",
    labelKey: "settings.themeSchemeForestGreen",
    descriptionKey: "settings.themeSchemeForestGreenHint",
    swatches: ["#dbe8dd", "#5b9e68", "#458451"],
  },
  {
    id: "twilight-violet",
    labelKey: "settings.themeSchemeTwilightViolet",
    descriptionKey: "settings.themeSchemeTwilightVioletHint",
    swatches: ["#e4def8", "#7f65cd", "#614fa6"],
  },
  {
    id: "amber-orange",
    labelKey: "settings.themeSchemeAmberOrange",
    descriptionKey: "settings.themeSchemeAmberOrangeHint",
    swatches: ["#f5e5c9", "#d68d1b", "#b57410"],
  },
  {
    id: "mint-aqua",
    labelKey: "settings.themeSchemeMintAqua",
    descriptionKey: "settings.themeSchemeMintAquaHint",
    swatches: ["#d6ece7", "#47a88f", "#378976"],
  },
  {
    id: "rosewood-red",
    labelKey: "settings.themeSchemeRosewoodRed",
    descriptionKey: "settings.themeSchemeRosewoodRedHint",
    swatches: ["#f0d9df", "#c15c76", "#9c455d"],
  },
];

export function isThemeScheme(
  value: string | null | undefined,
): value is ThemeScheme {
  if (!value) {
    return false;
  }

  return THEME_SCHEMES.some((scheme) => scheme.id === value);
}
