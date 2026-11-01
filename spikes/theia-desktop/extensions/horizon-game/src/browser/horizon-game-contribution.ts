import { injectable } from '@theia/core/shared/inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { HorizonGameWidget } from './horizon-game-widget';

export const HorizonGameCommand: Command = {
    id: 'horizon-ide.game.open',
    label: 'Horizon: Open Game View'
};

@injectable()
export class HorizonGameContribution extends AbstractViewContribution<HorizonGameWidget> {
    constructor() {
        super({
            widgetId: HorizonGameWidget.ID,
            widgetName: HorizonGameWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
            toggleCommandId: HorizonGameCommand.id
        });
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(HorizonGameCommand, {
            execute: () => this.openView({ activate: true, reveal: true })
        });
    }
}
