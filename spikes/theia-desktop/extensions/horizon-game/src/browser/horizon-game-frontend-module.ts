import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common';
import { WebSocketConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
import { HORIZON_BRIDGE_PATH, HorizonBridge } from '../common/horizon-bridge';
import { HorizonGameWidget } from './horizon-game-widget';
import { HorizonGameContribution } from './horizon-game-contribution';

export default new ContainerModule(bind => {
    bind(HorizonBridge).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy<HorizonBridge>(
            context.container, HORIZON_BRIDGE_PATH
        )
    ).inSingletonScope();

    bind(HorizonGameWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: HorizonGameWidget.ID,
        createWidget: () => context.container.get(HorizonGameWidget)
    })).inSingletonScope();

    bind(HorizonGameContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(HorizonGameContribution);
});
