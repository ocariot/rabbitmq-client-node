
import { IOptions } from "../port/configuration.inteface"

import { ConnectionRabbitMQ } from './connection.rabbitmq'
import { OcariotPubSubException } from '../exception/ocariotPubSub.exception'
import { IEventbusInterface } from '../port/eventbus.interface'
import { IEventHandler } from '../port/event.handler.interface'

export class EventBus implements IEventbusInterface{

    private pubconnection: ConnectionRabbitMQ = new ConnectionRabbitMQ;
    private subconnection: ConnectionRabbitMQ = new ConnectionRabbitMQ;

    private event_handlers: Map<string, IEventHandler<any>>

    public connect(host : string, port : number, username : string, password : string, options ?: IOptions): Promise<boolean | OcariotPubSubException>{

        return new Promise<boolean | OcariotPubSubException>(async (resolve, reject) => {
            try {
                await this.pubconnection.tryConnect(host, port, username, password, options)
                await this.subconnection.tryConnect(host, port, username, password, options)
                return resolve(true);
            }catch (err) {
                reject(new OcariotPubSubException(err));
                return false;
            }
        })
    }

    public close():Promise<boolean | OcariotPubSubException> {
        return new Promise<boolean | OcariotPubSubException>((resolve,reject) =>{
            try {
                if (this.pubconnection.closeConnection() && this.subconnection.closeConnection()) {
                    return resolve(true);
                }
            } catch (err) {
                reject(new OcariotPubSubException(err));
                return false;
            }
        })
    }

    get isConnected(): boolean {
        if (!this.pubconnection.isConnected || !this.pubconnection.isConnected)
            return false
        return true;
    }

    public publish(exchangeName: string, topicKey: string, message: any ):  Promise<boolean | OcariotPubSubException>{

        return new Promise<boolean | OcariotPubSubException>(async (resolve, reject) => {
            try{
                return resolve(this.pubconnection.sendMessage(exchangeName, topicKey, message))
            }catch (err) {
                reject(new OcariotPubSubException(err));
            }
        })
    }

    public subscribe(exchangeName: string, queueName: string, routing_key: string,  callback: IEventHandler<any> ): Promise<boolean | OcariotPubSubException>{
        return new Promise<boolean | OcariotPubSubException>(async (resolve, reject) => {
            try{
                return resolve(this.subconnection.receiveMessage(exchangeName, queueName, routing_key, callback))
            }catch (err) {
                reject(new OcariotPubSubException(err));
            }
        })
    }
}
