import { bodyTypeShortCode } from './body-type.util';

describe('bodyTypeShortCode', () => {
  it('maps TIPPER_CS → TPR-CS',             () => expect(bodyTypeShortCode('TIPPER_CS')).toBe('TPR-CS'));
  it('maps CHIPPER_TIPPER_TRAY_CRANE → CHPR', () => expect(bodyTypeShortCode('CHIPPER_TIPPER_TRAY_CRANE')).toBe('CHPR'));
  it('maps TRAY → TRAY',                     () => expect(bodyTypeShortCode('TRAY')).toBe('TRAY'));
  it('maps TAUTLINER → TAUT',                () => expect(bodyTypeShortCode('TAUTLINER')).toBe('TAUT'));
  it('maps BEAVERTAIL → BVR',                () => expect(bodyTypeShortCode('BEAVERTAIL')).toBe('BVR'));
  it('maps PANTECH_STEEL → PNT-ST',          () => expect(bodyTypeShortCode('PANTECH_STEEL')).toBe('PNT-ST'));
  it('maps PANTECH_AL → PNT-AL',             () => expect(bodyTypeShortCode('PANTECH_AL')).toBe('PNT-AL'));
  it('maps TILT_SLIDER → TILT',              () => expect(bodyTypeShortCode('TILT_SLIDER')).toBe('TILT'));
  it('maps TRAILER → TRL',                   () => expect(bodyTypeShortCode('TRAILER')).toBe('TRL'));
  it('maps BODY_SWAP → SWAP',                () => expect(bodyTypeShortCode('BODY_SWAP')).toBe('SWAP'));
  it('returns ? for unknown values',         () => expect(bodyTypeShortCode('UNKNOWN')).toBe('?'));
  it('returns ? for empty string',           () => expect(bodyTypeShortCode('')).toBe('?'));
});
