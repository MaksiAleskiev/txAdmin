const modulename = 'WebServer:SetupGet';
import path from 'path';
import logger from '@core/extras/console.js';
import { convars, txEnv } from '@core/globalData.js';
import { engineVersion } from '../../extras/deployer';
const { dir, log, logOk, logWarn, logError } = logger(modulename);

/**
 * Returns the output page containing the live console
 * @param {object} ctx
 */
export default async function SetupGet(ctx) {
    //Check permissions
    if (!ctx.utils.checkPermission('master', modulename)) {
        return ctx.utils.render('main/message', {message: 'You need to be the admin master to use the setup page.'});
    }

    // Check if this is the correct state for the setup page
    if (globals.deployer !== null) {
        return ctx.response.redirect('/deployer');
    }
    if (globals.fxRunner.config.serverDataPath && globals.fxRunner.config.cfgPath) {
        return ctx.response.redirect('/');
    }

    const globalConfig = globals.configVault.getScopedStructure('global');
    const renderData = {
        headerTitle: 'Setup',
        isReset: (globalConfig.serverName !== null),
        deployerEngineVersion: engineVersion,
        serverProfile: globals.info.serverProfile,
        txDataPath: txEnv.dataPath,
        isZapHosting: convars.isZapHosting,
        windowsBatPath: null,
    };

    if (txEnv.isWindows) {
        const batFolder = path.resolve(txEnv.fxServerPath, '..');
        renderData.windowsBatPath  = path.join(batFolder, `start_${txEnv.fxServerVersion}_${globals.info.serverProfile}.bat`);
    }

    return ctx.utils.render('standalone/setup', renderData);
};
