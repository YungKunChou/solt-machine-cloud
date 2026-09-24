class Element {
    constructor() {
        this.children = []; this.events = {}; this.style = {}; this.dataset = {}; this.attributes = {};
        this.value = ''; this.disabled = false; this.height = 80; this.width = 240; this.clientHeight = 150;
        const classes = new Set();
        this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x),
            toggle(x, on) { if (on) classes.add(x); else classes.delete(x); } };
    }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(n => n.textContent).join(''); }
    append(...nodes) { this.children.push(...nodes); for (const node of nodes) node.parentElement = this; }
    replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
    get firstElementChild() { return this.children[0]; }
    getBoundingClientRect() { return { height: this.height, width: this.width }; }
    get scrollHeight() { return 24; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
    fire(name, data = {}) { return Promise.all((this.events[name] || []).map(fn => fn({ target: this, preventDefault() {}, ...data }))); }
}
module.exports = { Element };
