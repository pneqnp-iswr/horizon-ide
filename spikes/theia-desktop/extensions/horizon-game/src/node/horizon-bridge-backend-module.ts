import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core/lib/common/messaging';
import { HORIZON_BRIDGE_PATH, HorizonBridge } from '../common/horizon-bridge';
import { HorizonBridgeService } from './horizon-bridge-service';

export default new ContainerModule(bind => {
    bind(HorizonBridgeService).toSelf().inSingletonScope();
    bind(ConnectionHandler).toDynamicValue(context =>
        new RpcConnectionHandler<HorizonBridge>(
            HORIZON_BRIDGE_PATH, () => context.container.get(HorizonBridgeService)
        )
    ).inSingletonScope();
});
