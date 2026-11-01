import * as React from '@theia/core/shared/react';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

/**
 * A real Theia dockable view, deliberately NOT a fake game renderer.
 * The cooperative Horizon HWND / WGPU viewport is a separate hardware gate.
 */
@injectable()
export class HorizonGameWidget extends ReactWidget {
    static readonly ID = 'horizon-ide:game';
    static readonly LABEL = 'Horizon Game';

    @postConstruct()
    protected init(): void {
        this.id = HorizonGameWidget.ID;
        this.title.label = HorizonGameWidget.LABEL;
        this.title.caption = 'Native Horizon game integration (not yet connected)';
        this.title.closable = true;
        this.update();
    }

    protected render(): React.ReactNode {
        const infoStyle: React.CSSProperties = {
            display: 'grid', gap: '10px', padding: '18px',
            color: 'var(--theia-foreground)', fontSize: '13px', lineHeight: 1.5
        };
        const message = (text: string) => React.createElement('p', { style: { margin: 0 } }, text);
        return React.createElement('section', {
            style: infoStyle, 'aria-label': 'Horizon Game integration status'
        },
            React.createElement('strong', null, 'Horizon Game — native integration gate'),
            message('This dockable panel is provided by the Theia workbench, not a static preview.'),
            message('A real Horizon Winit/WGPU window is NOT attached in this spike.'),
            message('The existing Tauri native-host experiment remains in PR #24.'),
            React.createElement('code', null, 'gameConnected=false · viewportPlayableVerified=false'),
            message('Next gate: explicitly approved Rust backend bridge, then owner-run Windows GPU/keyboard/mouse tests.')
        );
    }
}
