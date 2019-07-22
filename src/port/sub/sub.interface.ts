export interface ISub {

    sub(targetMicroservice: string, exchange: string, routingKey: string,
        callback: (message: any) => void): void

    receiveFromYourself(value: boolean): boolean

}
