/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { User } from 'azure-arm-website/lib/models';
import * as EventEmitter from 'events';
import { createServer, Server, Socket } from 'net';
import * as fetch from 'node-fetch';
import { SiteWrapper } from 'vscode-azureappservice';
import * as websocket from 'websocket';

export class DebugProxy extends EventEmitter {
    private _server: Server | undefined;
    private _wsclient: websocket.client | undefined;
    private _wsconnection: websocket.connection | undefined;
    private _accessToken: string;
    private _siteWrapper: SiteWrapper;
    private _port: number;
    private _publishProfile: User;
    private _keepAlive: boolean;

    constructor(siteWrapper: SiteWrapper, port: number, publishProfile: User, accessToken: string) {
        super();
        this._siteWrapper = siteWrapper;
        this._port = port;
        this._publishProfile = publishProfile;
        this._accessToken = accessToken;
        this._keepAlive = true;
        this._server = createServer();
    }

    public async startProxy(): Promise<void> {
        if (!this._server) {
            this.emit('error', new Error('Proxy server is not started.'));
        } else {
            // wake up the function app before connecting to it.
            await this.getFunctionState();

            this._server.on('connection', (socket: Socket) => {
                if (this._wsclient) {
                    this.emit('error', new Error(`[Server] client rejected ${socket.remoteAddress}:${socket.remotePort}`));
                    socket.destroy();
                } else {
                    // connected
                    socket.pause();

                    this._wsclient = new websocket.client();

                    this._wsclient.on('connect', (connection: websocket.connection) => {
                        this._wsconnection = connection;

                        connection.on('close', () => {
                            this.dispose();
                            socket.destroy();
                            this.emit('end');
                        });

                        connection.on('error', (err: Error) => {
                            this.dispose();
                            socket.destroy();
                            this.emit('error', err);
                        });

                        connection.on('message', (data: websocket.IMessage) => {
                            socket.write(data.binaryData);
                        });
                        socket.resume();
                    });

                    this._wsclient.on('connectFailed', (err: Error) => {
                        this.dispose();
                        socket.destroy();
                        this.emit('error', err);
                    });

                    this._wsclient.connect(
                        `wss://${this._siteWrapper.appName}.scm.azurewebsites.net/DebugSiteExtension/JavaDebugSiteExtension.ashx`,
                        undefined,
                        undefined,
                        { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
                        { auth: `${this._publishProfile.publishingUserName}:${this._publishProfile.publishingPassword}` }
                    );
                }

                socket.on('data', (data: Buffer) => {
                    if (this._wsconnection) {
                        this._wsconnection.send(data);
                    }
                });

                socket.on('end', () => {
                    this.dispose();
                    this.emit('end');
                });

                socket.on('error', (err: Error) => {
                    this.dispose();
                    socket.destroy();
                    this.emit('error', err);
                });
            });

            this._server.on('listening', () => {
                this.emit('start');
            });

            this._server.listen({
                host: 'localhost',
                port: this._port,
                backlog: 1
            });
            this.keepAlive();
        }
    }

    public dispose(): void {
        if (this._wsconnection) {
            this._wsconnection.close();
            this._wsconnection = undefined;
        }
        if (this._wsclient) {
            this._wsclient.removeAllListeners();
            this._wsclient = undefined;
        }
        if (this._server) {
            this._server.removeAllListeners();
            this._server.close();
            this._server = undefined;
        }
        this._keepAlive = false;
    }

    //keep querying the function app state, otherwise the connection will lose.
    private async keepAlive(): Promise<void> {
        if (this._keepAlive) {
            try {
                await this.getFunctionState();
                setTimeout(this.keepAlive, 60 * 1000 /* 60 seconds */);
            } catch (ex) {
                setTimeout(this.keepAlive, 5 * 1000 /* 5 seconds */);
            }
        }
    }

    private async getFunctionState(): Promise<void> {
        const functionAccessToken: string = await this.requestAsync(
            `https://${this._siteWrapper.appName}.scm.azurewebsites.net/api/functions/admin/token`,
            { headers: { Authorization: `Bearer ${this._accessToken}` } }
        );

        const functionMasterKey: {} = await this.requestAsync(
            `https://${this._siteWrapper.appName}.azurewebsites.net/admin/host/systemkeys/_master`,
            { headers: { Authorization: `Bearer ${functionAccessToken}` } }
        );

        // tslint:disable-next-line:no-string-literal
        await this.requestAsync(`https://${this._siteWrapper.appName}.azurewebsites.net/admin/host/status?code=${functionMasterKey['value']}`, {});
    }

    // tslint:disable-next-line:no-any
    private async requestAsync(url: string, options: fetch.RequestInit): Promise<any> {
        const response: fetch.Response = await fetch.default(url, options);
        try {
            return JSON.parse(await response.clone().json());
        } catch (err) {
            return JSON.parse(await response.text());
        }
    }
}
