import {
    amqpClient,
    IClientOptions,
    IConnection,
    IConnectionParams,
    IPubExchangeOptions,
    IServerOptions,
    IServerRegister,
    ISubExchangeOptions
} from 'amqp-client-node'
import {
    IMessageApplication,
    IMessageChild,
    IMessageEducator,
    IMessageEnvironment,
    IMessageFamily,
    IMessageFitbit,
    IMessageFood,
    IMessageHealthProfessional,
    IMessageInstitution,
    IMessageLog,
    IMessageNotification,
    IMessagePhysicalActivity,
    IMessageSleep,
    IMessageUser,
    IMessageWeigth
} from '../port/pub/message.interface'
import { RoutingKeysName } from '../utils/routing.keys.name'
import { ExchangeName } from '../utils/exchange.name'
import { EventName } from '../utils/event.name'
import { Configurations } from '../utils/configurations'
import { EventEmitter } from 'events'
import { IConnectionConfig } from '../port/connection/connection.config.interface'
import { IOcariotRabbitMQClient } from '../port/ocariot.rabbitmq.client.interface'
import { EndpointQueue } from '../utils/endpoint.queue'
import { ResourceName } from '../utils/resource.name'
import { IConnectionOption } from '../port/connection/connection.option.interface'

const defaultOptionPub: IPubExchangeOptions = {
    exchange: {
        durable: true,
        type: 'direct'
    }
}

const defaultOptionSub: ISubExchangeOptions = {
    consumer: { noAck: true },
    exchange: {
        durable: true,
        type: 'direct'
    },
    queue: {
        durable: true
    },
    receiveFromYourself: false
}

const defaultOptionRpcServer: IServerOptions = {
    consumer: { noAck: false },
    exchange: {
        durable: true,
        type: 'direct'
    },
    queue: {
        durable: true
    }
}

const defaultConnOpt: IConnectionOption = {
    retries: 0,
    interval: 1000
}

export class OcariotRabbitMQClient extends EventEmitter implements IOcariotRabbitMQClient {
    private readonly _connConfig: IConnectionParams | string
    private readonly _connOpt: IConnectionOption

    private defaultOptionRpcClient: IClientOptions = {
        exchange: {
            durable: true,
            type: 'direct'
        },
        rcpTimeout: 5000
    }

    private defaultConnConfig: IConnectionParams = {
        protocol: 'amqp',
        hostname: '127.0.0.1',
        port: 5672,
        username: 'guest',
        password: 'guest',
        vhost: 'ocariot'
    }

    private _pubConnection?: IConnection
    private _pubConnectionInitialized?: Promise<IConnection>
    private _subConnection?: IConnection
    private _subConnectionInitialized?: Promise<IConnection>
    private _serverConnection?: IConnection
    private _serverConnectionInitialized?: Promise<IConnection>
    private _clientConnection?: IConnection
    private _clientConnectionInitialized?: Promise<IConnection>

    constructor(private appName: string, connParams?: IConnectionConfig | string, connOptions?: IConnectionOption) {
        super()

        this._connConfig = this.defaultConnConfig

        if (typeof connParams === 'object') {
            this._connConfig = { ...this._connConfig, ...connParams } as IConnectionParams
        }

        if (typeof connParams === 'string') {
            this._connConfig = connParams.concat('/').concat(Configurations.VHOST)
        }

        this._connOpt = { ...defaultConnOpt, ...connOptions } as IConnectionOption

        if (connOptions) {
            if (connOptions.receiveFromYourself !== undefined)
                defaultOptionSub.receiveFromYourself = connOptions.receiveFromYourself
            if (connOptions.rpcTimeout)
                this.defaultOptionRpcClient.rcpTimeout = connOptions.rpcTimeout
        }
    }

    private pubEventInitialization(): void {
        if (!this._pubConnection) return

        this._pubConnection.on('disconnected', () => {
            this.emit('pub_disconnected')
            this._pubConnection = undefined
            this._pubConnectionInitialized = undefined
        })
        this._pubConnection.on('trying', () => this.emit('pub_trying_connection'))
        this._pubConnection.on('reestablished', () => this.emit('pub_reconnected'))
        this._pubConnection.on('_error', (err) => this.emit('pub_connection_error', err))
    }

    private subEventInitialization(): void {
        if (!this._subConnection) return

        this._subConnection.on('disconnected', () => {
            this.emit('sub_disconnected')
            this._subConnection = undefined
            this._subConnectionInitialized = undefined
        })
        this._subConnection.on('trying', () => this.emit('sub_trying_connection'))
        this._subConnection.on('reestablished', () => this.emit('sub_reconnected'))
        this._subConnection.on('_error', (err) => this.emit('sub_connection_error', err))
    }

    private serverEventInitialization(): void {
        if (!this._serverConnection) return

        this._serverConnection.on('disconnected', () => {
            this.emit('rpc_server_disconnected')
            this._serverConnection = undefined
            this._serverConnectionInitialized = undefined
        })
        this._serverConnection.on('trying', () => this.emit('rpc_server_trying_connection'))
        this._serverConnection.on('reestablished', () => this.emit('rpc_server_reconnected'))
        this._serverConnection.on('_error', (err) => this.emit('rpc_server_connection_error', err))
    }

    private clientEventInitialization(): void {
        if (!this._clientConnection) return

        this._clientConnection.on('disconnected', () => {
            this.emit('rpc_client_disconnected')
            this._clientConnection = undefined
            this._clientConnectionInitialized = undefined
        })
        this._clientConnection.on('trying', () => this.emit('rpc_client_trying_connection'))
        this._clientConnection.on('reestablished', () => this.emit('rpc_client_reconnected'))
        this._clientConnection.on('_error', (err) => this.emit('rpc_client_connection_error', err))
    }

    public logger(level: string, moduleName?: string): void {
        if (level === 'warn' || level === 'error' || level === 'info' || !level) {
            amqpClient.logger(level, moduleName)
        }
    }

    public async close(): Promise<void> {
        try {
            if (this._pubConnection) await this._pubConnection.close()
            if (this._subConnection) await this._subConnection.close()
            if (this._clientConnection) await this._clientConnection.close()
            if (this._serverConnection) await this._serverConnection.close()
            this.removeAllListeners()

            return Promise.resolve()
        } catch (err) {
            return Promise.reject(err)
        }
    }

    private async pubConnection(): Promise<void> {
        try {
            if (!this._pubConnection && !this._pubConnectionInitialized) {
                this._pubConnectionInitialized = amqpClient.createConnection(this._connConfig, this._connOpt)
                this._pubConnection = await this._pubConnectionInitialized
                this.pubEventInitialization()
                this.emit('pub_connected')
            }
            await this._pubConnectionInitialized
            return Promise.resolve()
        } catch (err) {
            this._pubConnection = undefined
            this._pubConnectionInitialized = undefined
            return Promise.reject(err)
        }
    }

    private async publish(exchangeName: string, routingKey: string, body: any): Promise<void> {
        try {
            await this.pubConnection()
            const message = { content: body }
            return this._pubConnection!.pub(exchangeName, routingKey, message, defaultOptionPub)
        } catch (err) {
            return Promise.reject(err)
        }
    }

    public async pub(routingKey: string, body: any): Promise<void> {
        try {
            await this.pubConnection()
            const message = { content: body }
            return this._pubConnection!.pub(ExchangeName.PERSONALIZED, routingKey, message, {
                exchange: {
                    durable: true,
                    type: 'topic'
                }
            })
        } catch (err) {
            return Promise.reject(err)
        }
    }

    private async subConnection(): Promise<void> {
        try {
            if (!this._subConnection && !this._subConnectionInitialized) {
                this._subConnectionInitialized = amqpClient.createConnection(this._connConfig, this._connOpt)
                this._subConnection = await this._subConnectionInitialized
                this.subEventInitialization()
                this.emit('sub_connected')
            }
            await this._subConnectionInitialized
            return Promise.resolve()
        } catch (err) {
            this._subConnection = undefined
            this._subConnectionInitialized = undefined
            return Promise.reject(err)
        }
    }

    public async sub(routingKey: string, callback: (message: any) => void): Promise<void> {
        try {
            await this.subConnection()
            const options = {
                ...defaultOptionSub, ...{
                    exchange: { durable: true, type: 'topic' }
                }
            }
            return this._subConnection!.sub(this.appName.concat(EndpointQueue.PERSONALIZED_SUB),
                ExchangeName.PERSONALIZED,
                routingKey,
                msg => callback(msg.content),
                options)
        } catch (err) {
            return Promise.reject(err)
        }
    }

    private async subscribe(exchangeName: string, routingKey: string, callback: (message: any) => void): Promise<void> {
        try {
            await this.subConnection()
            return this._subConnection!.sub(this.appName,
                exchangeName,
                routingKey,
                msg => callback(msg.content),
                defaultOptionSub)
        } catch (err) {
            return Promise.reject(err)
        }
    }

    private async serverConnection(): Promise<void> {
        try {
            if (!this._serverConnection && !this._serverConnectionInitialized) {
                this._serverConnectionInitialized = amqpClient.createConnection(this._connConfig, this._connOpt)
                this._serverConnection = await this._serverConnectionInitialized
                this.serverEventInitialization()
                this.emit('rpc_server_connected')
            }
            await this._serverConnectionInitialized
            return Promise.resolve()
        } catch (err) {
            this._serverConnection = undefined
            this._serverConnectionInitialized = undefined
            return Promise.reject(err)
        }
    }

    private async resource(exchangeName: string, name: string, func: (...any) => any[]): Promise<void> {
        try {
            await this.serverConnection()
            const server: IServerRegister = this._serverConnection!
                .createRpcServer(this.appName.concat(EndpointQueue.RPC), exchangeName, [], defaultOptionRpcServer)
            if (server.addResource(name, func)) return await server.start()
            return Promise.reject(new Error('Could not add resource to RPC Server. Resource already exists!'))
        } catch (err) {
            return Promise.reject(err)
        }
    }

    public async provide(name: string, func: (...any) => any): Promise<void> {
        try {
            await this.serverConnection()
            const server: IServerRegister = this._serverConnection!
                .createRpcServer(this.appName.concat(EndpointQueue.PERSONALIZED_RPC),
                    ExchangeName.PERSONALIZED_RPC, [], defaultOptionRpcServer)
            if (server.addResource(name, func)) return server.start()
            return Promise.reject(new Error('Could not add resource to RPC Server. Resource already exists!'))
        } catch (err) {
            return Promise.reject(err)
        }
    }

    public getResource(name: string, params: any[], callback: (err: Error, result: any) => any): void

    public getResource(name: string, params: any[]): Promise<any>

    public getResource(name: string, params: any[], callback?: (err: Error, result: any) => any): void | Promise<any> {
        if (!callback) {
            return this.getResourcePromise(ExchangeName.PERSONALIZED_RPC, name, params)
        }
        this.getResourceCallback(ExchangeName.PERSONALIZED_RPC, name, params, callback)
    }

    private requestResource(exchangeName: string, name: string, params: any[], callback: (err: Error, result: any) => any): void

    private requestResource(exchangeName: string, name: string, params: any[]): Promise<any>

    private requestResource(exchangeName: string, name: string, params: any[],
                            callback?: (err: Error, result: any) => any): void | Promise<any> {
        if (!callback) {
            return this.getResourcePromise(exchangeName, name, params)
        }
        this.getResourceCallback(exchangeName, name, params, callback)
    }

    public getResourceCallback(exchangeName: string, name: string, params: any[], callback: (...any) => any): void {
        let time: any
        if (!this._clientConnection) {
            new Promise<any>((res) => {
                time = setTimeout(res, this.defaultOptionRpcClient.rcpTimeout)
            }).then(() => {
                return callback(new Error('rpc timed out'))
            })
        }

        if (!this._clientConnection && !this._clientConnectionInitialized) {
            this._clientConnectionInitialized = amqpClient.createConnection(this._connConfig, this._connOpt)
            this._clientConnectionInitialized
                .then((conn) => {
                    this._clientConnection = conn
                    this.clientEventInitialization()
                    this.emit('rpc_client_connected')
                })
                .catch(() => {
                    this._clientConnectionInitialized = undefined
                })
        }

        if (!this._clientConnectionInitialized) return

        this._clientConnectionInitialized
            .then(() => {
                clearTimeout(time)
                this._clientConnection!.rpcClient(exchangeName, name, params, callback, this.defaultOptionRpcClient)
            })
            .catch(err => {
                callback(err, null)
            })
    }

    public async getResourcePromise(exchangeName: string, name: string, params: any[]): Promise<any> {
        return new Promise<any>(async (resolve, reject) => {
            try {
                let time: any
                if (!this._clientConnection) {
                    new Promise<any>((res) => {
                        time = setTimeout(res, this.defaultOptionRpcClient.rcpTimeout)
                    }).then(() => {
                        return reject(new Error('rpc timed out'))
                    })
                }

                if (!this._clientConnection && !this._clientConnectionInitialized) {
                    this._clientConnectionInitialized = amqpClient.createConnection(this._connConfig, this._connOpt)
                    this._clientConnection = await this._clientConnectionInitialized
                    this.clientEventInitialization()
                    this.emit('rpc_client_connected')
                }
                await this._clientConnectionInitialized
                clearTimeout(time)
                return resolve(this._clientConnection!.rpcClient(exchangeName, name, params, this.defaultOptionRpcClient))
            } catch (err) {
                this._clientConnectionInitialized = undefined
                return reject(err)
            }
        })
    }

    public pubSavePhysicalActivity(activity: any): Promise<void> {
        const message: IMessagePhysicalActivity = {
            event_name: EventName.SAVE_PHYSICAL_ACTIVITY_EVENT,
            timestamp: new Date().toISOString(),
            physicalactivity: activity
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_PHYSICAL_ACTIVITIES, message)
    }

    public pubUpdatePhysicalActivity(activity: any): Promise<void> {
        const message: IMessagePhysicalActivity = {
            event_name: EventName.UPDATE_PHYSICAL_ACTIVITY_EVENT,
            timestamp: new Date().toISOString(),
            physicalactivity: activity
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.UPDATE_PHYSICAL_ACTIVITIES, message)
    }

    public pubDeletePhysicalActivity(activity: any): Promise<void> {
        const message: IMessagePhysicalActivity = {
            event_name: EventName.DELETE_PHYSICAL_ACTIVITY_EVENT,
            timestamp: new Date().toISOString(),
            physicalactivity: activity
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.DELETE_PHYSICAL_ACTIVITIES, message)
    }

    public pubSaveSleep(sleep: any): Promise<void> {
        const message: IMessageSleep = {
            event_name: EventName.SAVE_SLEEP_EVENT,
            timestamp: new Date().toISOString(),
            sleep
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_SLEEP, message)
    }

    public pubUpdateSleep(sleep: any): Promise<void> {
        const message: IMessageSleep = {
            event_name: EventName.UPDATE_SLEEP_EVENT,
            timestamp: new Date().toISOString(),
            sleep
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.UPDATE_SLEEP, message)
    }

    public pubDeleteSleep(sleep: any): Promise<void> {
        const message: IMessageSleep = {
            event_name: EventName.DELETE_SLEEP_EVENT,
            timestamp: new Date().toISOString(),
            sleep
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.DELETE_SLEEP, message)
    }

    public pubSaveWeight(weight: any): Promise<void> {
        const message: IMessageWeigth = {
            event_name: EventName.SAVE_WEIGHT_EVENT,
            timestamp: new Date().toISOString(),
            weight
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_WEIGHTS, message)
    }

    public pubDeleteWeight(weight: any): Promise<void> {
        const message: IMessageWeigth = {
            event_name: EventName.DELETE_WEIGHT_EVENT,
            timestamp: new Date().toISOString(),
            weight
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.DELETE_WEIGHTS, message)
    }

    public pubSaveEnvironment(environment: any): Promise<void> {
        const message: IMessageEnvironment = {
            event_name: EventName.SAVE_ENVIRONMENT_EVENT,
            timestamp: new Date().toISOString(),
            environment
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_ENVIRONMENTS, message)
    }

    public pubDeleteEnvironment(environment: any): Promise<void> {
        const message: IMessageEnvironment = {
            event_name: EventName.DELETE_ENVIRONMENT_EVENT,
            timestamp: new Date().toISOString(),
            environment
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.DELETE_ENVIRONMENTS, message)
    }

    public pubSaveLog(log: any): Promise<void> {
        const message: IMessageLog = {
            event_name: EventName.SAVE_LOG_EVENT,
            timestamp: new Date().toISOString(),
            log
        }
        return this.publish(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_LOG, message)
    }

    public pubSaveChild(child: any): Promise<void> {
        const message: IMessageChild = {
            event_name: EventName.SAVE_CHILD_EVENT,
            timestamp: new Date().toISOString(),
            child
        }
        return this.publish(ExchangeName.ACCOUNT, RoutingKeysName.SAVE_CHILDREN, message)
    }

    public pubUpdateChild(child: any): Promise<void> {
        const message: IMessageChild = {
            event_name: EventName.UPDATE_CHILD_EVENT,
            timestamp: new Date().toISOString(),
            child
        }
        return this.publish(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_CHILDREN, message)
    }

    public pubUpdateFamily(family: any): Promise<void> {
        const message: IMessageFamily = {
            event_name: EventName.UPDATE_FAMILY_EVENT,
            timestamp: new Date().toISOString(),
            family
        }
        return this.publish(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_FAMILIES, message)
    }

    public pubUpdateEducator(educator: any): Promise<void> {
        const message: IMessageEducator = {
            event_name: EventName.UPDATE_EDUCATOR_EVENT,
            timestamp: new Date().toISOString(),
            educator
        }
        return this.publish(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_EDUCATORS, message)
    }

    public pubUpdateHealthProfessional(healthprofessional: any): Promise<void> {
        const message: IMessageHealthProfessional = {
            event_name: EventName.UPDATE_HEALTH_PROFESSIONAL_EVENT,
            timestamp: new Date().toISOString(),
            healthprofessional
        }
        return this.publish(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_HEALTH_PROFESSIONALS, message)
    }

    public pubUpdateApplication(application: any): Promise<void> {
        const message: IMessageApplication = {
            event_name: EventName.UPDATE_APPLICATION_EVENT,
            timestamp: new Date().toISOString(),
            application
        }
        return this.publish(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_APPLICATIONS, message)
    }

    public pubDeleteUser(user: any): Promise<void> {
        const message: IMessageUser = {
            event_name: EventName.DELETE_USER_EVENT,
            timestamp: new Date().toISOString(),
            user
        }

        return this.publish(ExchangeName.ACCOUNT, RoutingKeysName.DELETE_USERS, message)
    }

    public pubDeleteInstitution(institution: any): Promise<void> {
        const message: IMessageInstitution = {
            event_name: EventName.DELETE_INSTITUTION_EVENT,
            timestamp: new Date().toISOString(),
            institution
        }
        return this.publish(ExchangeName.ACCOUNT, RoutingKeysName.DELETE_INSTITUTIONS, message)
    }

    public pubFitbitLastSync(fitbit: any): Promise<void> {
        const message: IMessageFitbit = {
            event_name: EventName.LASTSYNC_FITBIT_FITBIT,
            timestamp: new Date().toISOString(),
            fitbit
        }
        return this.publish(ExchangeName.DATA_SYNC, RoutingKeysName.LAST_SYNC_FIIBIT, message)
    }

    public pubFitbitAuthError(fitbit: any): Promise<void> {
        const message: IMessageFitbit = {
            event_name: EventName.ERROR_FITBIT_AUTH_EVENT,
            timestamp: new Date().toISOString(),
            fitbit
        }
        return this.publish(ExchangeName.DATA_SYNC, RoutingKeysName.ERROR_FITBIT_AUTH, message)
    }

    public pubFitbitRevoke(fitbit: any): Promise<void> {
        const message: IMessageFitbit = {
            event_name: EventName.REVOKE_FITBIT_EVENT,
            timestamp: new Date().toISOString(),
            fitbit
        }
        return this.publish(ExchangeName.DATA_SYNC, RoutingKeysName.REVOKE_FITBIT, message)
    }

    public pubSyncPhysicalActivity(activity: any): Promise<void> {
        const message: IMessagePhysicalActivity = {
            event_name: EventName.SYNC_PHYSICAL_ACTIVITY_EVENT,
            timestamp: new Date().toISOString(),
            physicalactivity: activity
        }
        return this.publish(ExchangeName.DATA_SYNC, RoutingKeysName.SYNC_PHYSICAL_ACTIVITIES, message)
    }

    public pubSyncSleep(sleep: any): Promise<void> {
        const message: IMessageSleep = {
            event_name: EventName.SYNC_SLEEP_EVENT,
            timestamp: new Date().toISOString(),
            sleep
        }
        return this.publish(ExchangeName.DATA_SYNC, RoutingKeysName.SYNC_SLEEP, message)
    }

    public pubSyncWeight(weight: any): Promise<void> {
        const message: IMessageWeigth = {
            event_name: EventName.SYNC_WEIGHT_EVENT,
            timestamp: new Date().toISOString(),
            weight
        }
        return this.publish(ExchangeName.DATA_SYNC, RoutingKeysName.SYNC_WEIGHTS, message)
    }

    public pubSyncLog(log: any): Promise<void> {
        const message: IMessageLog = {
            event_name: EventName.SYNC_LOG_EVENT,
            timestamp: new Date().toISOString(),
            log
        }
        return this.publish(ExchangeName.DATA_SYNC, RoutingKeysName.SYNC_LOGS, message)
    }

    public pubSaveFood(food: any): Promise<void> {
        const message: IMessageFood = {
            event_name: EventName.SAVE_FOOD_EVENT,
            timestamp: new Date().toISOString(),
            food
        }
        return this.publish(ExchangeName.FOOD_TRACKING, RoutingKeysName.SAVE_FOODS, message)
    }

    public pubUpdateFood(food: any): Promise<void> {
        const message: IMessageFood = {
            event_name: EventName.UPDATE_FOOD_EVENT,
            timestamp: new Date().toISOString(),
            food
        }
        return this.publish(ExchangeName.FOOD_TRACKING, RoutingKeysName.UPDATE_FOODS, message)
    }

    public pubSendNotification(notification: any): Promise<void> {
        const message: IMessageNotification = {
            event_name: EventName.SEND_NOTIFICATION_EVENT,
            timestamp: new Date().toISOString(),
            notification
        }
        return this.publish(ExchangeName.NOTIFICATION, RoutingKeysName.SEND_NOTIFICATION, message)
    }

    public subSavePhysicalActivity(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_PHYSICAL_ACTIVITIES, callback)
    }

    public subUpdatePhysicalActivity(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.UPDATE_PHYSICAL_ACTIVITIES, callback)
    }

    public subDeletePhysicalActivity(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.DELETE_PHYSICAL_ACTIVITIES, callback)
    }

    public subSaveSleep(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_SLEEP, callback)
    }

    public subUpdateSleep(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.UPDATE_SLEEP, callback)
    }

    public subDeleteSleep(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.DELETE_SLEEP, callback)
    }

    public subSaveWeight(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_WEIGHTS, callback)
    }

    public subDeleteWeight(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.DELETE_WEIGHTS, callback)
    }

    public subSaveEnvironment(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_ENVIRONMENTS, callback)
    }

    public subDeleteEnvironment(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.DELETE_ENVIRONMENTS, callback)
    }

    public subSaveLog(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACTIVITY_TRACKING, RoutingKeysName.SAVE_LOG, callback)
    }

    public subSaveChild(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACCOUNT, RoutingKeysName.SAVE_CHILDREN, callback)
    }

    public subUpdateChild(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_CHILDREN, callback)
    }

    public subUpdateFamily(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_FAMILIES, callback)
    }

    public subUpdateEducator(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_EDUCATORS, callback)
    }

    public subUpdateHealthProfessional(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_HEALTH_PROFESSIONALS, callback)
    }

    public subUpdateApplication(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACCOUNT, RoutingKeysName.UPDATE_APPLICATIONS, callback)
    }

    public subDeleteUser(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACCOUNT, RoutingKeysName.DELETE_USERS, callback)
    }

    public subDeleteInstitution(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.ACCOUNT, RoutingKeysName.DELETE_INSTITUTIONS, callback)
    }

    public subFitbitLastSync(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.DATA_SYNC, RoutingKeysName.LAST_SYNC_FIIBIT, callback)
    }

    public subFitbitAuthError(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.DATA_SYNC, RoutingKeysName.ERROR_FITBIT_AUTH, callback)
    }

    public subFitbitRevoke(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.DATA_SYNC, RoutingKeysName.REVOKE_FITBIT, callback)
    }

    public subSyncPhysicalActivity(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.DATA_SYNC, RoutingKeysName.SYNC_PHYSICAL_ACTIVITIES, callback)
    }

    public subSyncSleep(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.DATA_SYNC, RoutingKeysName.SYNC_SLEEP, callback)
    }

    public subSyncWeight(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.DATA_SYNC, RoutingKeysName.SYNC_WEIGHTS, callback)
    }

    public subSyncLog(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.DATA_SYNC, RoutingKeysName.SYNC_LOGS, callback)
    }

    public subSaveFood(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.FOOD_TRACKING, RoutingKeysName.SAVE_FOODS, callback)
    }

    public subUpdateFood(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.FOOD_TRACKING, RoutingKeysName.UPDATE_FOODS, callback)
    }

    public subSendNotification(callback: (message: any) => void): Promise<void> {
        return this.subscribe(ExchangeName.NOTIFICATION, RoutingKeysName.SEND_NOTIFICATION, callback)
    }

    public providePhysicalActivities(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.PHYSICAL_ACTIVITIES, listener)
    }

    public provideSleep(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.SLEEP, listener)
    }

    public provideWeights(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.WEIGHTS, listener)
    }

    public provideEnvironments(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.ENVIRONMENTS, listener)
    }

    public provideLogs(listener: (childId: string, dateStart: string, dateEnd: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.LOGS, listener)
    }

    public provideChildren(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.CHILDREN, listener)
    }

    public provideFamilies(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.FAMILIES, listener)
    }

    public provideFamilyChildren(listener: (family_id: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.FAMILY_CHILDREN, listener)
    }

    public provideEducators(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS, listener)
    }

    public provideEducatorChildrenGroups(listener: (educator_id: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS_CHILDRES_GROUPS, listener)
    }

    public provideHealthProfessionals(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.HEALTH_PROFESSIONALS, listener)
    }

    public provideHealthProfessionalChildrenGroups(listener: (healthprofessional_id: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.HEALTH_PROFESSIONAL_CHILDREN_GROUPS, listener)
    }

    public provideApplications(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.APPLICATIONS, listener)
    }

    public provideInstitutions(listener: (query?: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.INSTITUTIONS, listener)
    }

    public provideEducatorsFromChild(listener: (childId: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS_FROM_CHILD, listener)
    }

    public provideHealthProfessionalsFromChild(listener: (childId: string) => any): Promise<void> {
        return this.resource(ExchangeName.ACCOUNT_RPC, ResourceName.HEALTH_PROFESSIONALS_FROM_CHILD, listener)
    }

    public provideFoods(listener: (childId: string, dateStart: string, dateEnd: string) => any): Promise<void> {
        return this.resource(ExchangeName.FOOD_TRACKING_RPC, ResourceName.FOODS, listener)
    }

    public provideProcessedDataChildren(listener: (childId?: string) => any): Promise<void> {
        return this.resource(ExchangeName.DSS_RPC, ResourceName.CHILDREN_PROCESS_DATA, listener)
    }

    public getPhysicalActivities(query: string, callback: (err: Error, result: any) => void): void

    public getPhysicalActivities(query?: string): Promise<any>

    public getPhysicalActivities(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.PHYSICAL_ACTIVITIES, [query])
        }
        this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.PHYSICAL_ACTIVITIES, [query], callback)
    }

    public getSleep(query: string, callback: (err: Error, result: any) => void): void

    public getSleep(query?: string): Promise<any>

    public getSleep(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.SLEEP, [query])
        }
        this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.SLEEP, [query], callback)
    }

    public getWeights(query: string, callback: (err: Error, result: any) => void): void

    public getWeights(query?: string): Promise<any>

    public getWeights(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.WEIGHTS, [query])
        }
        this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.WEIGHTS, [query], callback)
    }

    public getEnvironments(query: string, callback: (err: Error, result: any) => void): void

    public getEnvironments(query?: string): Promise<any>

    public getEnvironments(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.ENVIRONMENTS, [query])
        }
        this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.ENVIRONMENTS, [query], callback)
    }

    public getLogs(childId: string, dateStart: string, dateEnd: string, callback: (err: Error, result: any) => void): void

    public getLogs(childId: string, dateStart: string, dateEnd: string): Promise<any>

    public getLogs(childId: string, dateStart: string, dateEnd: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.LOGS, [childId, dateStart, dateEnd])
        }
        this.requestResource(ExchangeName.ACTIVITY_TRACKING_RPC, ResourceName.LOGS, [childId, dateStart, dateEnd], callback)
    }

    public getChildren(query: string, callback: (err: Error, result: any) => void): void

    public getChildren(query?: string): Promise<any>

    public getChildren(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.CHILDREN, [query])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.CHILDREN, [query], callback)
    }

    public getFamilies(query: string, callback: (err: Error, result: any) => void): void

    public getFamilies(query?: string): Promise<any>

    public getFamilies(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.FAMILIES, [query])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.FAMILIES, [query], callback)
    }

    public getFamilyChildren(familyId: string, callback: (err: Error, result: any) => void): void

    public getFamilyChildren(familyId: string): Promise<any>

    public getFamilyChildren(familyId: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.FAMILY_CHILDREN, [familyId])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.FAMILY_CHILDREN, [familyId], callback)
    }

    public getEducators(query: string, callback: (err: Error, result: any) => void): void

    public getEducators(query?: string): Promise<any>

    public getEducators(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS, [query])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS, [query], callback)
    }

    public getEducatorChildrenGroups(educatorId: string, callback: (err: Error, result: any) => void): void

    public getEducatorChildrenGroups(educatorId: string): Promise<any>

    public getEducatorChildrenGroups(educatorId: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS_CHILDRES_GROUPS, [educatorId])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS_CHILDRES_GROUPS, [educatorId], callback)
    }

    public getHealthProfessionals(query: string, callback: (err: Error, result: any) => void): void

    public getHealthProfessionals(query?: string): Promise<any>

    public getHealthProfessionals(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.HEALTH_PROFESSIONALS, [query])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.HEALTH_PROFESSIONALS, [query], callback)
    }

    public getHealthProfessionalChildrenGroups(healthProfessionalId: string, callback: (err: Error, result: any) => void): void

    public getHealthProfessionalChildrenGroups(healthProfessionalId: string): Promise<any>

    public getHealthProfessionalChildrenGroups(healthProfessionalId: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.HEALTH_PROFESSIONAL_CHILDREN_GROUPS,
                [healthProfessionalId])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC,
            ResourceName.HEALTH_PROFESSIONAL_CHILDREN_GROUPS, [healthProfessionalId], callback)
    }

    public getApplications(query: string, callback: (err: Error, result: any) => void): void

    public getApplications(query?: string): Promise<any>

    public getApplications(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.APPLICATIONS, [query])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.APPLICATIONS, [query], callback)
    }

    public getInstitutions(query: string, callback: (err: Error, result: any) => void): void

    public getInstitutions(query?: string): Promise<any>

    public getInstitutions(query?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.INSTITUTIONS, [query])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.INSTITUTIONS, [query], callback)
    }

    public getEducatorsFromChild(childId: string, callback: (err: Error, result: any) => void): void

    public getEducatorsFromChild(childId: string): Promise<any>

    public getEducatorsFromChild(childId: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS_FROM_CHILD, [childId])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.EDUCATORS_FROM_CHILD, [childId], callback)
    }

    public getHealthProfessionalsFromChild(childId: string, callback: (err: Error, result: any) => void): void

    public getHealthProfessionalsFromChild(childId: string): Promise<any>

    public getHealthProfessionalsFromChild(childId: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.HEALTH_PROFESSIONALS_FROM_CHILD, [childId])
        }
        this.requestResource(ExchangeName.ACCOUNT_RPC, ResourceName.HEALTH_PROFESSIONALS_FROM_CHILD, [childId], callback)
    }

    public getFoods(childId: string, dateStart: string, dateEnd: string, callback: (err: Error, result: any) => void): void

    public getFoods(childId: string, dateStart: string, dateEnd: string): Promise<any>

    public getFoods(childId: string, dateStart: string, dateEnd: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.FOOD_TRACKING_RPC, ResourceName.FOODS, [childId, dateStart, dateEnd])
        }
        this.requestResource(ExchangeName.FOOD_TRACKING_RPC, ResourceName.FOODS, [childId, dateStart, dateEnd], callback)
    }

    public getProcessedDataChildren(childId: string, callback: (err: Error, result: any) => void): void

    public getProcessedDataChildren(childId?: string): Promise<any>

    public getProcessedDataChildren(childId?: string, callback?: (err: Error, result: any) => void): any {
        if (!callback) {
            return this.requestResource(ExchangeName.DSS_RPC, ResourceName.CHILDREN_PROCESS_DATA, [childId])
        }
        this.requestResource(ExchangeName.DSS_RPC, ResourceName.CHILDREN_PROCESS_DATA, [childId], callback)
    }
}
