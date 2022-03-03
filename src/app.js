import 'skulpt';
import {EditorState, EditorView, basicSetup} from "@codemirror/basic-setup";
import {python} from "@codemirror/lang-python";

window.onload = () => {
    const textConsole = document.getElementById('console');
    //window.addEventListener('click', () => textConsole.focus());
    //window.addEventListener('paste', textConsole.onPaste.bind(textConsole), true);

    const turtle = document.getElementById('turtle-canvas');
    const repl = new PythonRepl(textConsole, turtle);
    textConsole.querySelector('text-console').focus();
    repl.run();
};


const INIT_SCRIPT = `
from turtle import *
from random import *
shape('turtle')

def help():
    print("Hi Tulsi! I haven't written much help yet.\\n")
    print('Try writing this:\\n')
    print("color 'green'")
    print('repeat 20:')
    print('  fd 100')
    print('  rt 100')
`;


class PythonRepl {
    constructor(console, turtleCanvas) {
        this.console = console;
        this.textConsole = console.querySelector('text-console');
        this.turtleCanvas = turtleCanvas;

        this.initSkulpt();

        this.plainText = {};

        // Edit existing var by typing the variable on its own.
        this.textConsole.addEditorHook((input) => {
            const trimmedInput = input.trim();
            const value = Sk.globals[trimmedInput];
            if (value === undefined) {
                return;
            }

            if (this.plainText[trimmedInput] !== undefined) {
              return this.plainText[trimmedInput];
            } else if (value instanceof Sk.builtins['function']) {
              return;
            } else {
              return `${trimmedInput} = ${Sk.builtin.repr(value).v}`;
            }
        });

        // TODO - replace with continuation exception. See changes to repl.js also.
        this.textConsole.addEditorHook((input) => {
            if (input.trim().match(/^(def|class|repeat|for|while)\s*.*:$/)) {
                return input.trim() + '\n    ';
            }
        });
    }

    canMutate(varName) {
        const val = Sk.globals[varName];
        if (val === undefined) {
            return false;
        }

        if (val instanceof Sk.builtins['function'] && !(trimmedInput in this.plainText)) {
            // TOOD At some point, this should probably be upgraded to integrate
            // with Skulpt more (i.e. Skulpt can maintain plain text representations of
            // everything rather than us).
            return false;
        }

        // How to distinguish between things that have sane reprs and those that don't?
        return true;
    }

    async run() {
        while (true) {
            this.textConsole.showPrompt();
            let input = await this.textConsole.readline();
            const trimmedInput = input.trim();
            if (trimmedInput === '') {
                continue;
            }

            if (trimmedInput == 'help') {
                input = 'help()';
            }

            // TODO - integrate with Skulpt to identify when globals were redefined rather than brute-force ugly?
            const oldGlobals = {...Sk.globals};
            // Parse AST first before running to check that only one thing is defined and possibly prevent
            // invalid saves... (or rather, have a separate path for handling invalid saves into this.plainText).
            const res = await this.runCode(input);
            window.res = res;
            if (res === undefined) {
                continue
            }
            if (res.$d['__last_expr_result__'] !== Sk.builtin.none.none$) {
                this.textConsole.output(Sk.builtin.repr(res.$d['__last_expr_result__']).v + '\n');
            }
            delete res.$d['__last_expr_result__'];

            const changes = Object.entries(Sk.globals).filter(([k, v]) => v !== oldGlobals[k]);
            if (changes.length === 1) {
              for (const [k, v] of changes) {
                console.log('change', k, v);
                this.plainText[k] = input;
              }
            }
        }
    }

    async runCode(code) {
        try {
            return await Sk.misceval.asyncToPromise(function() {
                return Sk.importMainWithBody("<stdin>", false, code, true);
            })
        } catch (e) {
            // TODO detect unterminated multi-line exception and trigger editor here.
            // This could avoid the realtime hook as well...
            // Err... in appropriate circumstances. Not all runCode. Refactor.
            if (e instanceof Sk.builtin.BaseException) {
                this.textConsole.output(e.toString() + '\n');
            } else {
                throw e;
            }
        }
    }

    initSkulpt() {
        const tgConfig = Sk.TurtleGraphics || (Sk.TurtleGraphics = {});
        tgConfig.target = this.turtleCanvas;
        tgConfig.width = 0;
        tgConfig.height = 0;
        Sk.configure({
            __future__: Sk.python3,
            output: this.textConsole.output.bind(this.textConsole),
            inputfun: this.textConsole.readline.bind(this),
            retainglobals: true,
        });

        this.runCode(INIT_SCRIPT);
    }
}


class TextConsole extends HTMLElement {
    constructor() {
        super();

        this.readlinePromise = null;
        this.readlinePromiseResolve = null;
        this.currentLine = '';
        this.oldLines = [];

        this.temporaryEditorView = null;
        this.editorHooks = [];

        this.shadow = this.attachShadow({mode: 'open'});
        this.consoleElem = document.getElementById('consoletemplate').content.cloneNode(true);
        this.shadow.append(this.consoleElem);

        this.boxElem = this.shadow.getElementById('box');

        // TODO doesn't work
        EditorView.domEventHandlers({resize: (event, view) => {
            this.parent.scrollTop = this.parent.scrollHeight;
        }});
    }

    connectedCallback() {
        // Dirty hack.
        this.parent = this.closest('div');

        // set up listeners!!
        this.prompt = this.getAttribute('data-prompt');
        this.output(this.getAttribute('data-intro') + '\n');
        this.addEventListener('keydown', this.onKeydown.bind(this), {capture: false});
        this.addEventListener('paste', this.onPaste.bind(this), {capture: false});
        this.addEventListener('focus', this.onFocus.bind(this), {capture: false});
    }

    addEditorHook(detectFn) {
        this.editorHooks.push(detectFn);
    }

    async readline() {
        if (this.readlinePromise !== null) {
            return await this.readlinePromise;
        }
        
        if (this.oldLines.length > 0) {
            return this.oldLines.shift();
        } else {
            this.readlinePromise = new Promise((resolve, reject) => {
                this.readlinePromiseResolve = resolve;
            });
            return await this.readlinePromise;
        }
    }

    output(text) {
        this.boxElem.textContent = this.boxElem.textContent.slice(0, -1);
        this.boxElem.append(document.createTextNode(text + '■'));
        if (text.includes('\n')) {
            this.parent.scrollTop = this.parent.scrollHeight;
        }
    }

    showPrompt() {
        this.output(this.prompt);
    }

    onPaste(event) {
        event.preventDefault();
        event.stopPropagation();

        const lines = event.clipboardData.getData('text').split('\n');
        if (lines.length > 1) {
          for (const line of lines.slice(0, -1)) {
            this.currentLine += line + '\n';
            this.output(line);
            this.onEnter();
          }
        }
        this.currentLine += lines[lines.length - 1];
        this.output(lines[lines.length - 1]);
    }

    onFocus(event) {
        if (this.temporaryEditorView) {
            event.preventDefault();
            event.stopPropagation();
            this.temporaryEditorView.focus();
        }
    }

    onKeydown(event) {
        event.preventDefault();
        event.stopPropagation();

        if (event.isComposing) {
            return;
        }

        switch(event.key) {
        case 'Shift':
        case 'Alt':
        case 'Control':
            break;
        case 'Enter':
            this.onEnter();
            break;
        case 'Backspace':
            this.onBackspace();
            break;
        default:
            this.currentLine += event.key;
            this.output(event.key);
            break;
        }
    }

    onBackspace() {
        if (this.currentLine.length > 0) {
            this.currentLine = this.currentLine.slice(0, -1);
            this.boxElem.textContent = this.boxElem.textContent.slice(0, -2) + '■';
        }
    }

    onEnter() {
        if (this.readlinePromise) {
            for (const hook of this.editorHooks) {
              // TODO handle oldLines in buffer...
              const proposedInput = hook(this.currentLine);
              if (proposedInput) {
                this.boxElem.textContent = this.boxElem.textContent.slice(0, -(this.currentLine.length + 1));
                this.spawnTemporaryEditor(proposedInput);
                return;
              }
            }
            this.readlinePromiseResolve(this.currentLine);
            this.readlinePromise = null;
        } else {
            this.oldLines.push(this.currentLine);
        }
        this.output('\n');
        this.currentLine = '';
    }

    spawnTemporaryEditor(proposedInput) {
        const view = this.temporaryEditorView = new EditorView({
            state: EditorState.create({doc: proposedInput, extensions: [basicSetup, python()]}),
            parent: this.parent,
        });
        view.focus();
        // TODO make it go to the bottom.
        view.moveVertically(view.state.selection.main, true);

        let onEditorFinish = (text) => {
            doneButton.remove();
            cancelButton.remove();
            this.temporaryEditorView.destroy();
            this.temporaryEditorView = null;
            // TODO - Print it out, but _only_ if it results in a change...
            this.focus();
            this.output('\n' + text + '\n');
            this.readlinePromiseResolve(text);
            this.readlinePromise = null;
            this.currentLine = '';
        };

        const doneButton = document.createElement('button');
        doneButton.append(document.createTextNode('Done'));
        doneButton.onclick = () => onEditorFinish(view.state.doc.toString());
        this.parent.append(doneButton);

        const cancelButton = document.createElement('button');
        cancelButton.append(document.createTextNode('Cancel'));
        cancelButton.onclick = () => onEditorFinish('');
        this.parent.append(cancelButton);
    }
}


customElements.define('text-console', TextConsole);