/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QuickPickItem } from 'vscode';
import * as nls from 'vscode-nls';
import * as errors from '../errors';
import * as crypto from "crypto";
import { UserCancelledError } from '../errors';

// asdf
export interface PartialList<T> extends Array<T> {
    nextLink?: string;
}

export async function listAll<T>(client: { listNext(nextPageLink: string): Promise<PartialList<T>>; }, first: Promise<PartialList<T>>): Promise<T[]> {
    const all: T[] = [];

    for (let list = await first; list.length || list.nextLink; list = list.nextLink ? await client.listNext(list.nextLink) : []) {
        all.push(...list);
    }

    return all;
}

export const localize: nls.LocalizeFunc = nls.config(process.env.VSCODE_NLS_CONFIG)();

export async function showQuickPick<T>(items: PickWithData<T>[] | Thenable<PickWithData<T>[]>, placeHolder: string, ignoreFocusOut?: boolean): Promise<PickWithData<T>>;
export async function showQuickPick(items: Pick[] | Thenable<Pick[]>, placeHolder: string, ignoreFocusOut?: boolean): Promise<Pick>;
export async function showQuickPick(items: vscode.QuickPickItem[] | Thenable<vscode.QuickPickItem[]>, placeHolder: string, ignoreFocusOut: boolean = false): Promise<vscode.QuickPickItem> {
    const options: vscode.QuickPickOptions = {
        placeHolder: placeHolder,
        ignoreFocusOut: ignoreFocusOut
    };
    const result: vscode.QuickPickItem | undefined = await vscode.window.showQuickPick(items, options);

    if (!result) {
        throw new errors.UserCancelledError();
    } else {
        return result;
    }
}

export async function showInputBox(placeHolder: string, prompt: string, ignoreFocusOut: boolean = false, validateInput?: (s: string) => string | undefined | null): Promise<string> {
    const options: vscode.InputBoxOptions = {
        placeHolder: placeHolder,
        prompt: prompt,
        validateInput: validateInput,
        ignoreFocusOut: ignoreFocusOut
    };
    const result: string | undefined = await vscode.window.showInputBox(options);

    if (!result) {
        throw new errors.UserCancelledError();
    } else {
        return result;
    }
}

export async function showFolderDialog(): Promise<string> {
    const defaultUri: vscode.Uri | undefined = vscode.workspace.rootPath ? vscode.Uri.file(vscode.workspace.rootPath) : undefined;
    const options: vscode.OpenDialogOptions = {
        defaultUri: defaultUri,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: localize('azFunc.select', 'Select')
    };
    const result: vscode.Uri[] | undefined = await vscode.window.showOpenDialog(options);

    if (!result || result.length === 0) {
        throw new errors.UserCancelledError();
    } else {
        return result[0].fsPath;
    }
}

export class Pick implements QuickPickItem {
    public readonly description: string;
    public readonly label: string;
    constructor(label: string, description?: string) {
        this.label = label;
        this.description = description ? description : '';
    }
}

export class PickWithData<T> extends Pick {
    public readonly data: T;
    constructor(data: T, label: string, description?: string) {
        super(label, description);
        this.data = data;
    }
}

// asdf
// export async function writeToFile(path: string, data: string): Promise<void> {
//     await new Promise((resolve: () => void, reject: (e: Error) => void): void => {
//         fs.writeFile(path, data, (error?: Error) => {
//             if (error) {
//                 reject(error);
//             } else {
//                 resolve();
//             }
//         });
//     });
// }

export async function signIn(): Promise<any> {
    return vscode.commands.executeCommand('azure-account.login');
}

export async function requireSignIn(): Promise<any> {
    // If not signed in, execute the sign in command and wait for it...
    if (this.azureAccount.signInStatus !== 'LoggedIn') {
        await signIn();
    }
    // Now check again, if still not signed in, cancel.
    if (this.azureAccount.signInStatus !== 'LoggedIn') {
        throw new UserCancelledError();
    }
}

// asdf
// export function errToString(error: any): string {
//     if (error === null || error === undefined) {
//         return '';
//     }

//     if (error instanceof Error) {
//         return JSON.stringify({
//             'Error': error.constructor.name,
//             'Message': error.message
//         });
//     }

//     if (typeof (error) === 'object') {
//         return JSON.stringify({
//             'object': error.constructor.name
//         });
//     }

//     return error.toString();
// }
