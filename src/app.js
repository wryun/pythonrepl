import 'skulpt';

window.onload = () => {
    const textConsole = document.getElementById('python-console');
    //window.addEventListener('click', () => textConsole.focus());
    window.addEventListener('paste', textConsole.onPaste.bind(textConsole), true);

    const turtle = document.getElementById('turtle-canvas');
    const repl = new PythonRepl(textConsole, turtle);
    textConsole.focus();
    repl.run();
};


const INIT_SCRIPT = `
from turtle import *
shape('turtle')
`;


class PythonRepl {
    constructor(textConsole, turtleCanvas) {
        this.textConsole = textConsole;
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

        // Defining function/class.
        // TODO - replace with continuation exception
        this.textConsole.addEditorHook((input) => {
            if (input.trim().match(/^(def|class\s*.*:$)/)) {
                return input.trim();
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
            const input = await this.textConsole.readline();
            const trimmedInput = input.trim();
            if (trimmedInput === '') {
                continue;
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
            const changes = Object.entries(Sk.globals).filter(([k, v]) => v !== oldGlobals[k]);
            if (changes.length !== 1) {
              // TODO - shouldn't happen.
              // (really, need to parse AST to prevent this before we eval, and make sure k is sane)
              return;
            }
            for (const [k, v] of changes) {
              this.plainText[k] = input;
            }

            if (res.$d['__last_expr_result__'] !== Sk.builtin.none.none$) {
                this.textConsole.output(Sk.builtin.repr(res.$d['__last_expr_result__']).v + '\n');
            }
            delete res.$d['__last_expr_result__'];
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
        (Sk.TurtleGraphics || (Sk.TurtleGraphics = {})).target = this.turtleCanvas;
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

        this.editorHooks = [];

        this.shadow = this.attachShadow({mode: 'open'});
        const template = document.getElementById('consoletemplate').content.cloneNode(true)
        this.shadow.append(template);
        
        this.boxElem = this.shadow.getElementById('box');
    }

    connectedCallback() {
        // set up listeners!!
        this.prompt = this.getAttribute('data-prompt');
        this.output(this.getAttribute('data-intro') + '\n');
        this.addEventListener('keydown', this.onKeydown.bind(this), true);
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
            this.output(line + '\n');
            this.onEnter();
          }
        }
        this.currentLine += lines[lines.length - 1];
        this.output(lines[lines.length - 1]);
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
            this.output('\n');
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
                console.log('should be spawning editor');
              }
            }
            this.readlinePromiseResolve(this.currentLine);
            this.readlinePromise = null;
        } else {
            this.oldLines.push(this.currentLine);
        }
        this.currentLine = '';
    }
}


customElements.define('text-console', TextConsole);