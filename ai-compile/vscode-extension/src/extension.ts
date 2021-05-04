// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { compile, getFix, LocalStorage } from "./util";
import { CodelensProvider } from "./code-lens/codeLensProvider";
import { Decorator } from "./decorator/decorator";

import * as t from "./types";
import * as c from "./constants";

let disposables: vscode.Disposable[] = [];
let eventDisposables: vscode.Disposable[] = [];

// file-wise history store
export let storageManager: LocalStorage;

// function getDocumentText(document: vscode.TextDocument): string {
// 	let invalidRange = new vscode.Range(0, 0, document.lineCount /*intentionally missing the '-1' */, 0);
// 	let fullRange = document.validateRange( invalidRange );
// 	return document.getText( fullRange );
// }

async function compileAndGetFixHelper(): Promise<t.Fix> {
  // TODO: What if user changes tab immediately? - activeEditor changes - cancellation token?
  //* Or find an alternate way to get fullText of document and simply pass document along
  const activeEditor = vscode.window.activeTextEditor;

  if (activeEditor !== undefined) {
    const document = activeEditor.document;
    const cursorPosition = activeEditor.selection.active;
    const filePath = document.uri.fsPath;
    let result: t.Fix = undefined;

    if (c.DEBUG) {
      console.log(`Compiling ${filePath}`);
    }
    const compiled = await compile(filePath);

    if (!compiled) {
      if (c.DEBUG) {
        console.log("Syntax Error -> Preparing and Sending data...");
      }
      const data: t.Payload = {
        // srcCode: getDocumentText( document ),
        source: document.getText(),
        lastEditLine: cursorPosition.line,
      };
      const payload: t.Payload = JSON.parse(JSON.stringify(data));

      if (c.baseURL === undefined) {
        console.log("Web Server path invalid");
        return undefined;
      } else {
        result = await getFix(c.baseURL!, payload);
        if (result !== undefined) {
          if (c.DEBUG) {
            console.log("Reply from Server:");
          }
        }
      }
    }

    return result;
  }
}

async function compileAndGetFix(
  document: vscode.TextDocument,
  storageManager: LocalStorage
): Promise<t.Fix> {
  const filePath = document.uri.fsPath;
  let fixes: t.Fix = undefined;
  let docHistory = storageManager.getValue<t.DocumentStore>(filePath);

  // TODO: What if the document was left in an inconsistent state previously
  // * Can handle this case in the document open/ close event?
  // compile if file has either not been examined previously (in the history of the extension) ||
  // it has been modified
  let compileFlag = docHistory === undefined || document.isDirty;

  // docHistory = docHistory?? new Document( filePath, undefined );
  // docHistory = docHistory?? {filePath: filePath, fixes: fixes};
  docHistory = docHistory ?? { filePath: filePath, fixes: fixes };

  if (compileFlag) {
    fixes = await compileAndGetFixHelper();
    docHistory.fixes = fixes;
    storageManager.setValue<t.DocumentStore>(filePath, docHistory);
  } else {
    fixes = docHistory.fixes;
    if (fixes !== undefined) {
      if (c.DEBUG) {
        console.log("Saved fixes from History:");
      }
    }
  }

  return fixes;
}

// TODO: Display respective corrections at respective lines when cursor comes on that line (?)
// * When a line is modified, then it needs re-compilation (as old fix at the line might have become stale)
function suggestFixes(fixes: t.Fix): void {
  if (fixes === undefined) {
    if (c.DEBUG) {
      console.log("Nothing to show");
    }
  } else {
    if (c.DEBUG) {
      console.log(fixes);
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  // console.log( storageManager.getValue("nonExistentKey") );
  if (c.DEBUG) {
    console.log("Extension 'python-hints' is now active!");
  }

  storageManager = new LocalStorage(context.globalState);
  const decorator: Decorator = new Decorator();

  disposables.push(
    vscode.commands.registerCommand(
      "python-hints.toggleHints",
      async function () {
        if (c.DEBUG) {
          console.log("toggleFix Command triggered...");
        }
        const flag = vscode.workspace
          .getConfiguration("python-hints")
          .get("enableCodeLens", false);
        vscode.workspace
          .getConfiguration("python-hints")
          .update("enableCodeLens", !flag, true);

        // TODO: Decide when to trigger execution of backend
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor !== undefined) {
          // vscode.workspace.getConfiguration( "python-hints" ).update( "enableCodeLens", true, true );
          // the save event will itself handle compilation and fix suggestions
          if (activeEditor.document.isDirty) {
            activeEditor.document.save();
          } else {
            // document.save() doesn't trigger if document isn't dirty
            const fixes = await compileAndGetFix(
              activeEditor.document,
              storageManager
            );
            suggestFixes(fixes);
          }
        }
      }
    )
  );

  disposables.push(
    vscode.commands.registerCommand(
      "python-hints.toggleHighlight",
      async function () {
        const flag = vscode.workspace
          .getConfiguration("python-hints")
          .get("activeHighlight", false);
        vscode.workspace
          .getConfiguration("python-hints")
          .update("activeHighlight", !flag, true);
        // Accomodate delay in propagating above configuration
        setTimeout(() => {
          decorator.updateDecorations();
        }, 500);
        // decorator.updateDecorations();
      }
    )
  );

  decorator.registerDecorator(context);

  eventDisposables.push(
    vscode.workspace.onWillSaveTextDocument(async (saveEvent) => {
      if (c.DEBUG) {
        console.log("Document Saved...");
      }
      // TODO: Need to distinguish first time save from rest? - as it captures wrong name (Untitled*) - how to then check the file after saving? - another event?
      // filename.split('.').pop() === 'py' - Check Python documents only
      if (saveEvent.reason === vscode.TextDocumentSaveReason.Manual) {
        const fixes = await compileAndGetFix(
          saveEvent.document,
          storageManager
        );
        suggestFixes(fixes);
        decorator.updateDecorations();
      }
    })
  );

  // document open event

  // document close event

  // on focus / change to - document event

  /*
   *	CodeLens
   */
  disposables.push(
    vscode.languages.registerCodeLensProvider("python", new CodelensProvider())
  );

  // disposables.push( vscode.window.registerFileDecorationProvider )

  disposables.push(
    vscode.commands.registerCommand("python-hints.codelensAction", () => {
      vscode.window.showInformationMessage("CodeLens action");
    })
  );

  disposables.forEach((item) => context.subscriptions.push(item));

  eventDisposables.forEach((item) => context.subscriptions.push(item));
}

export function deactivate() {
  if (disposables) {
    disposables.forEach((item) => item.dispose());
  }
  if (eventDisposables) {
    eventDisposables.forEach((item) => item.dispose());
  }

  disposables = [];
  eventDisposables = [];

  // flush extension storage
}
