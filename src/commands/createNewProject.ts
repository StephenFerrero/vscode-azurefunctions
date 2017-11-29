/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { OutputChannel } from 'vscode';
import { IUserInterface } from '../IUserInterface';
import { Pick } from '../IUserInterface';
import { localize } from '../localize';
import { TemplateLanguage } from '../templates/Template';
import { cpUtils } from '../utils/cpUtils';
import { confirmOverwriteFile } from '../utils/fs';
import * as fsUtil from '../utils/fs';
import { gitUtils } from '../utils/gitUtils';
import * as workspaceUtil from '../utils/workspace';
import { VSCodeUI } from '../VSCodeUI';

const taskId: string = 'launchFunctionApp';

const problemMatcher: {} = {
    owner: 'azureFunctions',
    pattern: [
        {
            regexp: '\\b\\B',
            file: 1,
            location: 2,
            message: 3
        }
    ],
    background: {
        activeOnStart: true,
        beginsPattern: '^.*Stopping host.*',
        endsPattern: '^.*Job host started.*'
    }
};

const tasksJsonForJavaScript: {} = {
    version: '2.0.0',
    tasks: [
        {
            label: localize('azFunc.launchFuncApp', 'Launch Function App'),
            identifier: taskId,
            type: 'shell',
            command: 'func host start',
            isBackground: true,
            presentation: {
                reveal: 'always'
            },
            problemMatcher: [
                problemMatcher
            ]
        }
    ]
};

const tasksJsonForJava: {} = {
    version: '2.0.0',
    tasks: [
        {
            label: localize('azFunc.launchFuncApp', 'Launch Function App'),
            identifier: taskId,
            linux: {
                command: 'sh -c "mvn clean package -B && func host start --script-root %path%"'
            },
            osx: {
                command: 'sh -c "mvn clean package -B && func host start --script-root %path%"'
            },
            windows: {
                command: 'powershell mvn clean package -B; func host start --script-root %path%'
            },
            type: 'shell',
            isBackground: true,
            presentation: {
                reveal: 'always'
            },
            problemMatcher: [
                problemMatcher
            ]
        }
    ]
};

const attachToFunc: string = localize('azFunc.attachToFunc', 'Attach to Azure Functions');
const launchJsonForJavaScript: {} = {
    version: '0.2.0',
    configurations: [
        {
            name: attachToFunc,
            type: 'node',
            request: 'attach',
            port: 5858,
            protocol: 'inspector',
            preLaunchTask: taskId
        }
    ]
};

const launchJsonForJava: {} = {
    version: '0.2.0',
    configurations: [
        {
            name: attachToFunc,
            type: 'java',
            request: 'attach',
            hostName: 'localhost',
            port: 5005,
            preLaunchTask: taskId
        }
    ]
};

const launchJsonForCSharp: {} = {
    version: '0.2.0',
    configurations: [
        {
            name: attachToFunc,
            type: 'mono',
            request: 'attach',
            address: 'localhost',
            port: 55555,
            preLaunchTask: taskId
        }
    ]
};

// tslint:disable-next-line:no-multiline-string
const gitignore: string = `bin
obj
csx
.vs
edge
Publish
.vscode

*.user
*.suo
*.cscfg
*.Cache
project.lock.json

/packages
/TestResults

/tools/NuGet.exe
/App_Data
/secrets
/data
.secrets
appsettings.json
local.settings.json
`;

const hostJson: {} = {};

const localSettingsJson: {} = {
    IsEncrypted: false,
    Values: {
        AzureWebJobsStorage: ''
    }
};

async function promotForMavenParameters(ui: IUserInterface, functionAppPath: string): Promise<IMavenParameters> {
    const groupIdPlaceHolder: string = localize('azFunc.java.groupIdPlaceholder', 'Group ID');
    const groupIdPrompt: string = localize('azFunc.java.groupIdPrompt', 'Provide value for groupId');
    const groupId: string = await ui.showInputBox(groupIdPlaceHolder, groupIdPrompt, false, undefined, 'com.function');

    const artifactIdPlaceHolder: string = localize('azFunc.java.artifactIdPlaceholder', 'Artifact ID');
    const artifactIdprompt: string = localize('azFunc.java.artifactIdPrompt', 'Provide value for artifactId');
    const artifactId: string = await ui.showInputBox(artifactIdPlaceHolder, artifactIdprompt, false, undefined, path.basename(functionAppPath));

    const versionPlaceHolder: string = localize('azFunc.java.versionPlaceHolder', 'Version');
    const versionPrompt: string = localize('azFunc.java.versionPrompt', 'Provide value for version');
    const version: string = await ui.showInputBox(versionPlaceHolder, versionPrompt, false, undefined, '1.0-SNAPSHOT');

    const packagePlaceHolder: string = localize('azFunc.java.packagePlaceHolder', 'Package');
    const packagePrompt: string = localize('azFunc.java.packagePrompt', 'Provide value for package');
    const packageName: string = await ui.showInputBox(packagePlaceHolder, packagePrompt, false, undefined, groupId);

    const appNamePlaceHolder: string = localize('azFunc.java.appNamePlaceHolder', 'App Name');
    const appNamePrompt: string = localize('azFunc.java.appNamePrompt', 'Provide value for appName');
    const appName: string = await ui.showInputBox(appNamePlaceHolder, appNamePrompt, false, undefined, `${artifactId}-${Date.now()}`);

    return {
        groupId: groupId,
        artifactId: artifactId,
        version: version,
        packageName: packageName,
        appName: appName
    };
}

export async function createNewProject(outputChannel: OutputChannel, functionAppPath?: string, openFolder: boolean = true, ui: IUserInterface = new VSCodeUI()): Promise<void> {
    if (functionAppPath === undefined) {
        functionAppPath = await workspaceUtil.selectWorkspaceFolder(ui, localize('azFunc.selectFunctionAppFolderNew', 'Select the folder that will contain your function app'));
    }

    const languages: Pick[] = Object.keys(TemplateLanguage).map((key: string): Pick => { return new Pick(TemplateLanguage[key]); });
    const language: string = (await ui.showQuickPick(languages, localize('azFunc.selectFuncTemplate', 'Select a language for your function project'))).label;

    let javaTargetPath: string = '';
    switch (language) {
        case TemplateLanguage.Java:
            // Get parameters for Maven command
            const { groupId, artifactId, version, packageName, appName } = await promotForMavenParameters(ui, functionAppPath);
            // Use maven command to init Java function project.
            await cpUtils.executeCommand(
                outputChannel,
                functionAppPath,
                'mvn',
                'archetype:generate',
                '-DarchetypeGroupId="com.microsoft.azure"',
                '-DarchetypeArtifactId="azure-functions-archetype"',
                `-DgroupId="${groupId}"`,
                `-DartifactId="${artifactId}"`,
                `-Dversion="${version}"`,
                `-Dpackage="${packageName}"`,
                `-DappName="${appName}"`,
                '-B' // in Batch Mode
            );

            functionAppPath = path.join(functionAppPath, artifactId);
            javaTargetPath = `target/azure-functions/${appName}/`;
            break;
        default:
            // the maven archetype contains these files, so not check them when language is Java
            const hostJsonPath: string = path.join(functionAppPath, 'host.json');
            if (await confirmOverwriteFile(hostJsonPath)) {
                await fsUtil.writeFormattedJson(hostJsonPath, hostJson);
            }

            const localSettingsJsonPath: string = path.join(functionAppPath, 'local.settings.json');
            if (await confirmOverwriteFile(localSettingsJsonPath)) {
                await fsUtil.writeFormattedJson(localSettingsJsonPath, localSettingsJson);
            }
            break;
    }

    const vscodePath: string = path.join(functionAppPath, '.vscode');
    await fse.ensureDir(vscodePath);

    if (await gitUtils.isGitInstalled(functionAppPath)) {
        await gitUtils.gitInit(outputChannel, functionAppPath);

        const gitignorePath: string = path.join(functionAppPath, '.gitignore');
        if (language !== TemplateLanguage.Java && await confirmOverwriteFile(gitignorePath)) {
            await fse.writeFile(gitignorePath, gitignore);
        }
    }

    const tasksJsonPath: string = path.join(vscodePath, 'tasks.json');
    if (await confirmOverwriteFile(tasksJsonPath)) {
        switch (language) {
            case TemplateLanguage.Java:
                let tasksJsonString: string = JSON.stringify(tasksJsonForJava);
                tasksJsonString = tasksJsonString.replace(/%path%/g, javaTargetPath);
                // tslint:disable-next-line:no-string-literal no-unsafe-any
                const tasksJson: {} = JSON.parse(tasksJsonString);
                // tslint:disable-next-line:no-string-literal no-unsafe-any
                tasksJson['tasks'][0]['problemMatcher'][0]['background']['beginsPattern'] = '^.*Scanning for projects.*';
                await fsUtil.writeFormattedJson(tasksJsonPath, tasksJson);
                break;
            default:
                await fsUtil.writeFormattedJson(tasksJsonPath, tasksJsonForJavaScript);
                // this works for C# as well
                break;
        }
    }

    const launchJsonPath: string = path.join(vscodePath, 'launch.json');
    if (await confirmOverwriteFile(launchJsonPath)) {
        switch (language) {
            case TemplateLanguage.Java:
                await fsUtil.writeFormattedJson(launchJsonPath, launchJsonForJava);
                break;
            case TemplateLanguage.CSharp:
                await fsUtil.writeFormattedJson(launchJsonPath, launchJsonForCSharp);
                break;
            default:
                await fsUtil.writeFormattedJson(launchJsonPath, launchJsonForJavaScript);
                break;
        }
    }

    if (openFolder && !workspaceUtil.isFolderOpenInWorkspace(functionAppPath)) {
        // If the selected folder is not open in a workspace, open it now. NOTE: This may restart the extension host
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(functionAppPath), false);
    }
}

interface IMavenParameters {
    groupId: string;
    artifactId: string;
    version: string;
    packageName: string;
    appName: string;
}
