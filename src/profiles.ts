/**
 * Detection profiles: the DS-specific data behind the inline drift rules
 * (token-fingerprint, prop-match, sub-component). The engine itself is generic;
 * a profile tells it what to look for.
 *
 * A profile is built per run from (1) the built-in data for whichever known design
 * systems appear in `component_library`, and (2) custom data from `.polder.yml`
 * (`tokens`, `class_prefixes`, `prop_signatures`, `sub_components`, `name_segments`).
 * Built-ins are matched by package so a Carbon repo is never flagged with MUI palette
 * names for coincidental hex values — and a custom DS gets real inline detection
 * instead of silently getting none.
 */

export interface DetectionProfile {
  /** Hardcoded design-token values: lowercase `#rrggbb` hex → token label. */
  tokens: Record<string, string>;
  /** Patterns matching DS-specific CSS class names (e.g. `cds--*`, `Mui*-*`). */
  classPatterns: RegExp[];
  /** DS component name → distinctive prop names (see PROP_MATCH_* thresholds). */
  propSignatures: Record<string, string[]>;
  /** Sub-component JSX element name → canonical DS parent component. */
  subComponentMap: Record<string, string>;
  /** PascalCase word segment → canonical DS parent (confidence boost only). */
  nameSegments: Record<string, string>;
}

/** The custom-detection subset of `.polder.yml` (camelCased by config parsing). */
export interface CustomDetection {
  tokens?: Record<string, string>;
  classPrefixes?: string[];
  propSignatures?: Record<string, string[]>;
  subComponents?: Record<string, string>;
  nameSegments?: Record<string, string>;
}

export function emptyProfile(): DetectionProfile {
  return { tokens: {}, classPatterns: [], propSignatures: {}, subComponentMap: {}, nameSegments: {} };
}

/**
 * Merge two CustomDetection layers: `extra` wins per entry (records) and unions
 * (prefix lists). Used to underlay a generated `.polder.profile.yml` beneath the
 * hand-written `.polder.yml` keys, so manual config always has the last word.
 */
export function mergeCustomDetection(base: CustomDetection, extra: CustomDetection): CustomDetection {
  const out: CustomDetection = {};
  if (base.tokens || extra.tokens) out.tokens = { ...base.tokens, ...extra.tokens };
  if (base.classPrefixes || extra.classPrefixes) {
    out.classPrefixes = [...new Set([...(base.classPrefixes ?? []), ...(extra.classPrefixes ?? [])])];
  }
  if (base.propSignatures || extra.propSignatures) {
    out.propSignatures = { ...base.propSignatures, ...extra.propSignatures };
  }
  if (base.subComponents || extra.subComponents) {
    out.subComponents = { ...base.subComponents, ...extra.subComponents };
  }
  if (base.nameSegments || extra.nameSegments) {
    out.nameSegments = { ...base.nameSegments, ...extra.nameSegments };
  }
  return out;
}

// ── Carbon Design System (@carbon/*) ─────────────────────────────────────────

// Carbon v11 (White theme) — high-specificity hex tokens. Values common to any UI
// (#fff, #ccc, generic grays) are intentionally omitted to keep false positives low.
const CARBON_TOKENS: Record<string, string> = {
  '#0f62fe': 'interactive / blue-60',
  '#0043ce': 'interactive-02 / blue-70',
  '#002d9c': 'interactive-03 / blue-80',
  '#161616': 'text-primary / gray-100',
  '#da1e28': 'support-error / red-60',
  '#198038': 'support-success / green-50',
  '#24a148': 'support-success-hover / green-40',
  '#f1c21b': 'support-warning / yellow-30',
  '#ff832b': 'support-caution / orange-40',
  '#ba4e00': 'support-caution-dark / orange-70',
  '#4589ff': 'interactive-hover / blue-40',
  '#007d79': 'teal-60',
  '#08bdba': 'teal-40',
  '#6929c4': 'purple-70',
};

// Key props per Carbon component. Only distinctive props — broad enough to catch
// forks, tight enough to avoid false positives on unrelated shared prop names.
const CARBON_PROP_SIGNATURES: Record<string, string[]> = {
  Button:              ['kind', 'size', 'disabled', 'renderIcon', 'iconDescription'],
  IconButton:          ['label', 'kind', 'size', 'onClick', 'disabled'],
  Tag:                 ['type', 'filter', 'onClose', 'size'],
  Tile:                ['light', 'href', 'clicked'],
  Modal:               ['open', 'onRequestClose', 'modalHeading', 'primaryButtonText', 'secondaryButtonText'],
  TextInput:           ['id', 'labelText', 'value', 'onChange', 'placeholder', 'invalid', 'invalidText'],
  NumberInput:         ['value', 'onChange', 'min', 'max', 'step', 'label', 'invalidText'],
  Select:              ['id', 'labelText', 'value', 'onChange', 'disabled'],
  Dropdown:            ['id', 'label', 'items', 'onChange', 'selectedItem'],
  Checkbox:            ['id', 'labelText', 'checked', 'onChange', 'disabled', 'indeterminate'],
  Toggle:              ['id', 'labelText', 'toggled', 'onToggle', 'disabled'],
  InlineNotification:  ['kind', 'title', 'subtitle', 'onCloseButtonClick', 'actions', 'lowContrast'],
  OverflowMenu:        ['flipped', 'renderIcon', 'iconDescription', 'selectorPrimaryFocus'],
  ProgressBar:         ['value', 'max', 'label', 'status'],
  DataTable:           ['rows', 'headers', 'render'],
};

const CARBON_SUBCOMPONENT_MAP: Record<string, string> = {
  // Modal family
  ModalBody:                'Modal',
  ModalHeader:              'Modal',
  ModalFooter:              'Modal',
  // DataTable family
  TableToolbar:             'DataTable',
  TableToolbarContent:      'DataTable',
  TableToolbarSearch:       'DataTable',
  TableBatchActions:        'DataTable',
  TableSelectAll:           'DataTable',
  TableSelectRow:           'DataTable',
  TableExpandRow:           'DataTable',
  TableExpandedRow:         'DataTable',
  TableExpandHeader:        'DataTable',
  TableContainer:           'DataTable',
  // Header family
  HeaderName:               'Header',
  HeaderNavigation:         'Header',
  HeaderMenuItem:           'Header',
  HeaderGlobalBar:          'Header',
  // SideNav family
  SideNavItems:             'SideNav',
  SideNavMenu:              'SideNav',
  SideNavMenuItem:          'SideNav',
  SideNavLink:              'SideNav',
  // misc
  BreadcrumbItem:           'Breadcrumb',
  ProgressStep:             'ProgressIndicator',
  ContentSwitcherSwitch:    'ContentSwitcher',
  TabList:                  'Tabs',
  TabPanels:                'Tabs',
  TabPanel:                 'Tabs',
  NotificationActionButton: 'ActionableNotification',
};

export const CARBON_PROFILE: DetectionProfile = {
  tokens: CARBON_TOKENS,
  classPatterns: [/\bcds--[a-z][a-z0-9-]*/g],
  propSignatures: CARBON_PROP_SIGNATURES,
  subComponentMap: CARBON_SUBCOMPONENT_MAP,
  // Conservative: only words distinctive enough to reduce false-positive risk.
  // Generic words (Button, Input, Text, Icon, List…) are deliberately excluded.
  nameSegments: {
    Tag:      'Tag',
    Tile:     'Tile',
    Dropdown: 'Dropdown',
  },
};

// ── Material UI (@mui/*) ─────────────────────────────────────────────────────

// MUI v5 default theme palette — high-specificity values only.
const MUI_TOKENS: Record<string, string> = {
  '#1976d2': 'primary.main',
  '#1565c0': 'primary.dark',
  '#42a5f5': 'primary.light',
  '#d32f2f': 'error.main',
  '#c62828': 'error.dark',
  '#ef5350': 'error.light',
  '#2e7d32': 'success.main',
  '#388e3c': 'success.light',
  '#1b5e20': 'success.dark',
  '#ed6c02': 'warning.main',
  '#e65100': 'warning.dark',
  '#ff9800': 'warning.light',
  '#0288d1': 'info.main',
  '#01579b': 'info.dark',
  '#29b6f6': 'info.light',
};

const MUI_PROP_SIGNATURES: Record<string, string[]> = {
  MuiSlider: ['value', 'onChange', 'min', 'max', 'step', 'marks', 'valueLabelDisplay', 'disabled'],
  MuiRating: ['value', 'onChange', 'precision', 'max', 'size', 'readOnly', 'disabled'],
  MuiChip:   ['label', 'onDelete', 'color', 'size', 'variant', 'icon', 'disabled'],
  MuiBadge:  ['badgeContent', 'color', 'overlap', 'anchorOrigin', 'invisible', 'max'],
  MuiSelect: ['value', 'onChange', 'label', 'multiple', 'renderValue', 'disabled'],
};

const MUI_SUBCOMPONENT_MAP: Record<string, string> = {
  // Card family
  CardMedia:                'MuiCard',
  CardContent:              'MuiCard',
  CardHeader:               'MuiCard',
  CardActions:              'MuiCard',
  // Dialog family
  DialogTitle:              'MuiDialog',
  DialogContent:            'MuiDialog',
  DialogActions:            'MuiDialog',
  DialogContentText:        'MuiDialog',
  // Accordion family
  AccordionSummary:         'MuiAccordion',
  AccordionDetails:         'MuiAccordion',
  // List family
  ListItemText:             'MuiList',
  ListItemIcon:             'MuiList',
  ListItemSecondaryAction:  'MuiList',
  ListSubheader:            'MuiList',
  // Stepper family
  StepLabel:                'MuiStepper',
  StepContent:              'MuiStepper',
  StepIcon:                 'MuiStepper',
  // Table family
  TableHead:                'MuiTable',
  TableBody:                'MuiTable',
  TableRow:                 'MuiTable',
  TableCell:                'MuiTable',
  TableFooter:              'MuiTable',
  TablePagination:          'MuiTable',
  // misc
  ImageListItem:            'MuiImageList',
  ImageListItemBar:         'MuiImageList',
  PaginationItem:           'MuiPagination',
  SpeedDialAction:          'MuiSpeedDial',
  BottomNavigationAction:   'MuiBottomNavigation',
  TreeItem:                 'MuiTreeView',
  TimelineItem:             'MuiTimeline',
  TimelineDot:              'MuiTimeline',
  TimelineContent:          'MuiTimeline',
  TimelineConnector:        'MuiTimeline',
  TimelineSeparator:        'MuiTimeline',
};

export const MUI_PROFILE: DetectionProfile = {
  tokens: MUI_TOKENS,
  classPatterns: [/\bMui[A-Z][a-zA-Z]+-[a-z][a-zA-Z0-9-]*/g],
  propSignatures: MUI_PROP_SIGNATURES,
  subComponentMap: MUI_SUBCOMPONENT_MAP,
  nameSegments: {
    Card:        'MuiCard',
    Slider:      'MuiSlider',
    Rating:      'MuiRating',
    Chip:        'MuiChip',
    Badge:       'MuiBadge',
    Dialog:      'MuiDialog',
    Accordion:   'MuiAccordion',
    Drawer:      'MuiDrawer',
    Pagination:  'MuiPagination',
    Snackbar:    'MuiSnackbar',
    Skeleton:    'MuiSkeleton',
    Stepper:     'MuiStepper',
    Tooltip:     'MuiTooltip',
    Breadcrumbs: 'MuiBreadcrumbs',
  },
};

// ── Profile construction ─────────────────────────────────────────────────────

/** Built-in profiles matched against the configured `component_library` packages. */
const BUILTIN_PROFILES: { matches: (pkg: string) => boolean; profile: DetectionProfile }[] = [
  { matches: (pkg) => pkg.startsWith('@carbon/'), profile: CARBON_PROFILE },
  { matches: (pkg) => pkg.startsWith('@mui/'), profile: MUI_PROFILE },
];

export function mergeProfiles(base: DetectionProfile, extra: DetectionProfile): DetectionProfile {
  return {
    tokens: { ...base.tokens, ...extra.tokens },
    classPatterns: [...base.classPatterns, ...extra.classPatterns],
    propSignatures: { ...base.propSignatures, ...extra.propSignatures },
    subComponentMap: { ...base.subComponentMap, ...extra.subComponentMap },
    nameSegments: { ...base.nameSegments, ...extra.nameSegments },
  };
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/** A class prefix from config becomes "prefix followed by any class-name tail". */
function classPrefixToPattern(prefix: string): RegExp {
  return new RegExp(`\\b${prefix.replace(REGEX_SPECIALS, '\\$&')}[a-zA-Z0-9_-]*`, 'g');
}

/**
 * The profile for one run: built-in data for every configured package that matches a
 * known design system, plus any custom detection data from `.polder.yml`. A package
 * matching no built-in contributes nothing here — its drift is still caught by the
 * export-based rules (import-drift, local-shadow), which need no profile.
 */
export function buildDetectionProfile(
  canonicalPkgs: string[],
  custom?: CustomDetection,
): DetectionProfile {
  let profile = emptyProfile();
  for (const { matches, profile: builtin } of BUILTIN_PROFILES) {
    if (canonicalPkgs.some(matches)) profile = mergeProfiles(profile, builtin);
  }
  if (custom) {
    // Token keys are matched against lowercased hex values, so normalise here rather
    // than trusting every caller to (config parsing does, direct callers may not).
    const tokens: Record<string, string> = {};
    for (const [hex, label] of Object.entries(custom.tokens ?? {})) tokens[hex.toLowerCase()] = label;
    profile = mergeProfiles(profile, {
      tokens,
      classPatterns: (custom.classPrefixes ?? []).map(classPrefixToPattern),
      propSignatures: custom.propSignatures ?? {},
      subComponentMap: custom.subComponents ?? {},
      nameSegments: custom.nameSegments ?? {},
    });
  }
  return profile;
}

/**
 * Every built-in profile merged — the fallback when the caller has no package list to
 * match against (e.g. `checkInlineDrift` invoked directly without a profile).
 */
export function allBuiltinProfiles(): DetectionProfile {
  return BUILTIN_PROFILES.reduce((acc, b) => mergeProfiles(acc, b.profile), emptyProfile());
}
