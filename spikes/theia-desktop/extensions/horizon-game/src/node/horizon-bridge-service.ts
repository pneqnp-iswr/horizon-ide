import { injectable } from '@theia/core/shared/inversify';
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { BridgeProbe, HorizonBridge } from '../common/horizon-bridge';

const unavailable = (status: 'not_configured' | 'failed', detail: string): BridgeProbe => ({
    protocolVersion: 1,
    backend: 'rust-sidecar',
    status,
    gameConnected: false,
    viewportPlayableVerified: false,
    detail
});

/**
 * The absolute executable path is supplied by the desktop owner/environment,
 * never by renderer input, project files or AI output.
 * This intentionally exposes only one harmless read-only probe method.
 */
@injectable()
export class HorizonBridgeService implements HorizonBridge {
    async getProbe(): Promise<BridgeProbe> {
        const binary = process.env.HORIZON_IDE_SIDECAR_PATH;
        if (!binary) {
            return unavailable('not_configured', 'Set HORIZON_IDE_SIDECAR_PATH to an explicitly built, trusted Rust sidecar.');
        }
        if (!isAbsolute(binary) || (process.platform === 'win32' && !binary.toLowerCase().endsWith('.exe'))) {
            return unavailable('failed', 'Sidecar location must be an absolute executable path.');
        }
        try {
            const stdout = await new Promise<string>((resolve, reject) => {
                execFile(binary, ['--probe'], {
                    timeout: 3000, maxBuffer: 4096, windowsHide: true,
                    shell: false
                }, (error, out) => error ? reject(error) : resolve(out));
            });
            const payload: unknown = JSON.parse(stdout);
            if (typeof payload !== 'object' || payload === null) {
                return unavailable('failed', 'Sidecar returned a non-object response.');
            }
            const p = payload as Record<string, unknown>;
            if (p.protocolVersion !== 1 || p.backend !== 'rust-sidecar' || p.status !== 'ready' ||
                p.gameConnected !== false || p.viewportPlayableVerified !== false ||
                typeof p.detail !== 'string' || p.detail.length > 512) {
                return unavailable('failed', 'Sidecar protocol version or response schema mismatch.');
            }
            return p as unknown as BridgeProbe;
        } catch {
            return unavailable('failed', 'Rust sidecar failed to run or its response was invalid; inspect local build and path.');
        }
    }
}
