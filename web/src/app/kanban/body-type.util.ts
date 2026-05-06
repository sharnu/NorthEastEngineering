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
