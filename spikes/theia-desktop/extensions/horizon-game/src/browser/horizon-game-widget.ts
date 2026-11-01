import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { BridgeProbe, HorizonBridge } from '../common/horizon-bridge';

/** Real Theia view, intentionally NOT a fake game preview or renderer. */
@injectable()
export class HorizonGameWidget extends ReactWidget {
    static readonly ID = 'horizon-ide:game';
    static readonly LABEL = 'Horizon Game';

    @inject(HorizonBridge)
    protected readonly bridge!: HorizonBridge;
    private probeResult: BridgeProbe | undefined;
    private pending = false;

    @postConstruct()
    protected init(): void {
        this.id = HorizonGameWidget.ID;
        this.title.label = HorizonGameWidget.LABEL;
        this.title.caption = 'Native Horizon integration — hardware gate pending';
        this.title.closable = true;
        this.update();
    }

    protected async probeRust(): Promise<void> {
        if (this.pending) { return; }
        this.pending = true;
        this.update();
        try {
            this.probeResult = await this.bridge.getProbe();
        } catch {
            this.probeResult = {
                protocolVersion: 1, backend: 'rust-sidecar', status: 'failed',
                gameConnected: false, viewportPlayableVerified: false,
                detail: 'Theia backend connection failed.'
            };
        } finally {
            this.pending = false;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        const style: React.CSSProperties = {
            display: 'grid', gap: '12px', padding: '18px',
            color: 'var(--theia-foreground)', fontSize: '13px', lineHeight: 1.5
        };
        const p = (value: string) => React.createElement('p', { style: { margin: 0 } }, value);
        return React.createElement('section', {
            style, 'aria-label': 'Horizon Game integration status'
        },
            React.createElement('strong', null, 'Horizon Game — Native Integration'),
            p('This view belongs to the real Theia desktop workbench.'),
            p('No real Horizon window is attached yet. The Tauri HWND experiment remains in PR #24.'),
            React.createElement('button', {
                className: 'theia-button',
                disabled: this.pending,
                onClick: () => { void this.probeRust(); }
            }, this.pending ? 'Checking Rust...' : 'Check Rust backend transport'),
            this.probeResult ? React.createElement('div', { role: 'status' },
                React.createElement('strong', null, 'Rust transport: ' + this.probeResult.status),
                p(this.probeResult.detail)
            ) : p('Rust transport: not checked'),
            React.createElement('code', null, 'gameConnected=false · viewportPlayableVerified=false'),
            p('Hardware gate: native WGPU frames, focus, mouse-look, inventory, resize and shutdown.')
        );
    }
}
