import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/settings';

describe('plugin settings', () => {
	it('disables reduced board file writes by default', () => {
		expect(DEFAULT_SETTINGS.reduceBoardFileWrites).toBe(false);
	});
});
