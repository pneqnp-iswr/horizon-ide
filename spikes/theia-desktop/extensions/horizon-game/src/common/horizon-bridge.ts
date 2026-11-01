/** Theia frontend/backend RPC. No game-launch/OS-execution methods are exposed. */
export const HORIZON_BRIDGE_PATH = '/services/horizon-ide/bridge/v1';
export const HorizonBridge = Symbol('HorizonBridge');

export interface BridgeProbe {
    protocolVersion: 1;
    backend: 'rust-sidecar';
    status: 'ready' | 'not_configured' | 'failed';
    gameConnected: false;
    viewportPlayableVerified: false;
    detail: string;
}

export interface HorizonBridge {
    getProbe(): Promise<BridgeProbe>;
}
