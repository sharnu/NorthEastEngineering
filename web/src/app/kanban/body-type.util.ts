const SHORT_CODES: Record<string, string> = {
  TIPPER_CS:              'TPR-CS',
  CHIPPER_TIPPER_TRAY_CRANE: 'CHPR',
  TRAY:                   'TRAY',
  TAUTLINER:              'TAUT',
  BEAVERTAIL:             'BVR',
  PANTECH_STEEL:          'PNT-ST',
  PANTECH_AL:             'PNT-AL',
  TILT_SLIDER:            'TILT',
  TRAILER:                'TRL',
  BODY_SWAP:              'SWAP',
};

export function bodyTypeShortCode(bodyType: string): string {
  return SHORT_CODES[bodyType] ?? '?';
}

const LABELS: Record<string, string> = {
  TIPPER_CS:                 'Tipper CS',
  CHIPPER_TIPPER_TRAY_CRANE: 'Chipper/Tipper/Tray/Crane',
  TRAY:                      'Tray',
  TAUTLINER:                 'Tautliner',
  BEAVERTAIL:                'Beavertail',
  PANTECH_STEEL:             'Pantech (Steel)',
  PANTECH_AL:                'Pantech (Aluminium)',
  TILT_SLIDER:               'Tilt Slider',
  TRAILER:                   'Trailer',
  BODY_SWAP:                 'Body Swap',
};

export function bodyTypeLabel(bodyType: string): string {
  return LABELS[bodyType] ?? bodyType;
}
