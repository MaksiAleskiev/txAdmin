const modulename = 'Database';
import fsp from 'node:fs/promises';
import low from 'lowdb';
import FileAsync from 'lowdb/adapters/FileAsync'
import logger from '@core/extras/console.js';
import { convars, verbose } from '@core/globalData.js';
import { genActionID } from './idGenerator.js';
const { dir, log, logOk, logWarn, logError } = logger(modulename);


//Consts
export const SAVE_PRIORITY_LOW = 1;
export const SAVE_PRIORITY_MEDIUM = 2;
export const SAVE_PRIORITY_HIGH = 3;
const BACKUP_INTERVAL = 300e3;
const SAVE_STANDBY = 0;
const DATABASE_VERSION = 2;
const SAVE_TIMES = [300e3, 58e3, 28e3, 13e3];
// considering a 2 sec skew for the setInterval
// saving every 5 minutes even if nothing changed

//LowDB prod serializer
const ldbProdSerializer = {
    defaultValue: {},
    serialize: JSON.stringify,
    deserialize: JSON.parse,
};
const ldbSerializer = (!convars.isDevMode) ? ldbProdSerializer : undefined;


/**
 * FIXME: Optimization:
 * https://www.npmjs.com/package/bfj
 * https://www.npmjs.com/package/JSONStream
 * https://www.npmjs.com/package/json-stream-stringify
 *
 * Test:
 * - write a players.json simulating 300k players array
 * - write a standalone code to load lowdb file, filter it once, then write it
 * - execute `/usr/bin/time -v node test.js`
 * - do that with variation of updated lowdb and then using a json stream
 */
export class Database {
    constructor(wipePendingWLOnStart) {
        this.dbPath = `${globals.info.serverProfilePath}/data/playersDB.json`;
        this.backupPath = `${globals.info.serverProfilePath}/data/playersDB.backup.json`;
        this.writePending = SAVE_STANDBY;
        this.lastWrite = 0;
        this.obj = null;

        //Start database instance
        this.setupDatabase(wipePendingWLOnStart);

        //Cron functions
        setInterval(() => {
            this.writeDatabase();
        }, SAVE_TIMES[SAVE_PRIORITY_HIGH]);
        setInterval(() => {
            this.backupDatabase();
        }, BACKUP_INTERVAL);
    }


    /**
     * Start lowdb instance and set defaults
     */
    async setupDatabase(wipePendingWLOnStart) {
        //Tries to load the database
        let dbo;
        try {
            const adapterAsync = new FileAsync(this.dbPath, ldbSerializer);
            dbo = await low(adapterAsync);
        } catch (errorMain) {
            logError('Your txAdmin player/actions database could not be loaded.');
            try {
                await fsp.copyFile(this.backupPath, this.dbPath);
                const adapterAsync = new FileAsync(this.dbPath, ldbSerializer);
                dbo = await low(adapterAsync);
                logWarn('The database file was restored with the automatic backup file.');
                logWarn('A five minute rollback is expected.');
            } catch (errorBackup) {
                logError('It was also not possible to load the automatic backup file.');
                logError(`Main error: '${errorMain.message}'`);
                logError(`Backup error: '${errorBackup.message}'`);
                logError(`Database path: '${this.dbPath}'`);
                logError('If there is a file in that location, you may try to delete or restore it manually.');
                process.exit();
            }
        }

        //Setting up loaded database
        try {
            await dbo.defaults({
                version: DATABASE_VERSION,
                players: [],
                actions: [],
                pendingWL: [],
            }).write();

            const importedVersion = await dbo.get('version').value();
            if (importedVersion !== DATABASE_VERSION) {
                this.obj = await this.migrateDB(dbo, importedVersion);
            } else {
                this.obj = dbo;
            }

            // await this.obj.set('players', []).write(); //Wipe players
            if (wipePendingWLOnStart) await this.obj.set('pendingWL', []).write();
            this.lastWrite = Date.now();
        } catch (error) {
            logError('Failed to setup database object.');
            dir(error);
            process.exit();
        }
    }


    /**
     * Handles the migration of the database
     * @param {object} dbo
     * @param {string} oldVersion
     * @returns {object} lodash database
     */
    async migrateDB(dbo, currVersion) {
        if (currVersion === DATABASE_VERSION) {
            return dbo;
        }
        if (typeof currVersion !== 'number') {
            logError('Your players database version is not a number!');
            process.exit();
        }
        if (currVersion > DATABASE_VERSION) {
            logError(`Your players database is on v${currVersion}, and this txAdmin supports up to v${DATABASE_VERSION}.`);
            logError('This means you likely downgraded your txAdmin version. Please update txAdmin.');
            process.exit(1);
        }

        //Migrate database
        if (currVersion < 1) {
            logWarn(`Migrating your players database from v${currVersion} to v1. Wiping all the data.`);
            await dbo.set('version', 1)
                .set('players', [])
                .set('actions', [])
                .set('pendingWL', [])
                .write();
            currVersion = 1;
        }

        if (currVersion == 1) {
            logWarn('Migrating your players database from v1 to v2.');
            logWarn('This process will change any duplicated action ID and wipe pending whitelist.');
            const actionIDStore = new Set();
            const actionsToFix = [];
            await dbo.get('actions').forEach((a) => {
                if (!actionIDStore.has(a.id)) {
                    actionIDStore.add(a.id);
                } else {
                    actionsToFix.push(a);
                }
            }).value();
            logWarn(`Actions to fix: ${actionsToFix.length}`);
            for (let i = 0; i < actionsToFix.length; i++) {
                const action = actionsToFix[i];
                action.id = await genActionID(actionIDStore, action.type);
                actionIDStore.add(action.id);
            }
            await dbo.set('version', 2)
                .set('pendingWL', [])
                .write();
            currVersion = 2;
        }

        if (currVersion !== DATABASE_VERSION) {
            logError(`Your players database is on v${currVersion}, which is different from this version of txAdmin (v${DATABASE_VERSION}).`);
            logError('Since there is currently no migration method ready for the migration, txAdmin will attempt to use it anyways.');
            logError('Please make sure your txAdmin is on the most updated version!');
            process.exit(1);
        }
        return dbo;
    }


    /**
     * Creates a copy of the database file
     */
    async backupDatabase() {
        try {
            await fsp.copyFile(this.dbPath, this.backupPath);
            if (verbose) logOk('Database file backed up.');
        } catch (error) {
            logError(`Failed to backup database file '${this.dbPath}'`);
            if (verbose) dir(error);
        }
    }


    /**
     * Set write pending flag
     * @param {int} flag
     */
    writeFlag(flag = SAVE_PRIORITY_MEDIUM) {
        if (![SAVE_PRIORITY_LOW, SAVE_PRIORITY_MEDIUM, SAVE_PRIORITY_HIGH].includes(flag)) {
            throw new Error('unknown priority flag!');
        }
        if (flag > this.writePending) {
            if (verbose) log(`writeFlag > ${['no', 'low', 'med', 'high'][flag]}`);
            this.writePending = flag;
        }
    }


    /**
     * Writes the database to the disk, taking in consideration the priority flag
     */
    async writeDatabase() {
        //Check if the database is ready
        if (this.obj === null) return;

        const timeStart = Date.now();
        const sinceLastWrite = timeStart - this.lastWrite;

        if (this.writePending === SAVE_PRIORITY_HIGH || sinceLastWrite > SAVE_TIMES[this.writePending]) {
            try {
                await this.obj.write();
                const timeElapsed = Date.now() - timeStart;
                this.writePending = SAVE_STANDBY;
                this.lastWrite = timeStart;
                if (verbose) logOk(`DB file saved, took ${timeElapsed}ms.`);
            } catch (error) {
                logError(`Failed to save players database with error: ${error.message}`);
                if (verbose) dir(error);
            }
        } else {
            if (verbose) logOk('Skipping DB file save.');
        }
    }
}
