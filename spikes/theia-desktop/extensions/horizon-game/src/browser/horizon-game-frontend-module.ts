import { ContainerModule } from '@theia/core/shared/inversify';
import { CommandContribution } from '@theia/core/lib/common';
import { WidgetFactory } from '@theia/core/lib/browser';
import { HorizonGameWidget } from './horizon-game-widget';
import { HorizonGameContribution } from './horizon-game-contribution';

export default new ContainerModule(bind => {
    bind(HorizonGameWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: HorizonGameWidget.ID,
        createWidget: () => context.container.get(HorizonGameWidget)
    })).inSingletonScope();
    bind(HorizonGameContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(HorizonGameContribution);
});
