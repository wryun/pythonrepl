import 'skulpt'

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
    }

    async run() {
        while (true) {
            this.textConsole.showPrompt();
            const input = await this.textConsole.readline();
            if (input.trim() === '') {
                continue;
            }
            await this.runCode(`__result = ${input}\nif __result is not None: print(repr(__result))`);
        }
    }

    async runCode(code) {
        try {
            return await Sk.misceval.asyncToPromise(function() {
                return Sk.importMainWithBody("<stdin>", false, code, true);
            })
        } catch (e) {
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
            this.readlinePromiseResolve(this.currentLine);
            this.readlinePromise = null;
        } else {
            this.oldLines.push(this.currentLine);
        }
        this.currentLine = '';
    }
}


customElements.define('text-console', TextConsole);