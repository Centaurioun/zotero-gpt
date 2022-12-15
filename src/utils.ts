import Addon from "./addon";
import AddonModule from "./module";

class AddonUtils extends AddonModule {
  public Compat: ZoteroCompat;
  public Tool: ZoteroTool;
  public UI: ZoteroUI;

  constructor(parent: Addon) {
    super(parent);
    this.Compat = {
      // Get Zotero instance
      getZotero: () => {
        if (typeof Zotero === "undefined") {
          return Components.classes["@zotero.org/Zotero;1"].getService(
            Components.interfaces.nsISupports
          ).wrappedJSObject;
        }
        return Zotero;
      },
      // Check if it's running on Zotero 7 (Firefox 102)
      isZotero7: () => Zotero.platformMajorVersion >= 102,
      // Firefox 102 support DOMParser natively
      getDOMParser: () =>
        this.Compat.isZotero7()
          ? new DOMParser()
          : Components.classes[
              "@mozilla.org/xmlextras/domparser;1"
            ].createInstance(Components.interfaces.nsIDOMParser),
      // create XUL element
      createXULElement: (doc: Document, type: string) => {
        if (this.Compat.isZotero7()) {
          // @ts-ignore
          return doc.createXULElement(type);
        } else {
          return doc.createElementNS(
            "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
            type
          ) as XUL.Element;
        }
      },
    };
    this.Tool = {
      getCopyHelper: () => new CopyHelper(),
      openFilePicker: (
        title: string,
        mode: "open" | "save" | "folder",
        filters?: [string, string][],
        suggestion?: string
      ) => {
        const fp = Components.classes[
          "@mozilla.org/filepicker;1"
        ].createInstance(Components.interfaces.nsIFilePicker);

        if (suggestion) fp.defaultString = suggestion;

        mode = {
          open: Components.interfaces.nsIFilePicker.modeOpen,
          save: Components.interfaces.nsIFilePicker.modeSave,
          folder: Components.interfaces.nsIFilePicker.modeGetFolder,
        }[mode];

        fp.init(window, title, mode);

        for (const [label, ext] of filters || []) {
          fp.appendFilter(label, ext);
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return new Promise((resolve) => {
          fp.open((userChoice) => {
            switch (userChoice) {
              case Components.interfaces.nsIFilePicker.returnOK:
              case Components.interfaces.nsIFilePicker.returnReplace:
                resolve(fp.file.path);
                break;

              default: // aka returnCancel
                resolve("");
                break;
            }
          });
        });
      },
      log: (...data: any[]) => {
        try {
          this._Addon.Zotero.getMainWindow().console.log(data);
          for (const d of data) {
            this._Addon.Zotero.debug(d);
          }
        } catch (e) {
          this._Addon.Zotero.debug(e);
        }
      },
    };
    this.UI = {
      createElement: (
        doc: Document,
        tagName: string,
        namespace: "html" | "svg" | "xul" = "html"
      ) => {
        namespace = namespace || "html";
        const namespaces = {
          html: "http://www.w3.org/1999/xhtml",
          svg: "http://www.w3.org/2000/svg",
        };
        if (tagName === "fragment") {
          return doc.createDocumentFragment();
        } else if (namespace === "xul") {
          return this.Compat.createXULElement(doc, tagName);
        } else {
          return doc.createElementNS(namespaces[namespace], tagName) as
            | HTMLElement
            | SVGAElement;
        }
      },
      creatElementsFromJSON: (doc: Document, options: ElementOptions) => {
        this.Tool.log(options);
        if (
          options.id &&
          (options.checkExistanceParent
            ? options.checkExistanceParent
            : doc
          ).querySelector(`#${options.id}`)
        ) {
          if (options.ignoreIfExists) {
            return undefined;
          }
          if (options.removeIfExists) {
            doc.querySelector(`#${options.id}`).remove();
          }
        }
        if (options.customCheck && !options.customCheck()) {
          return undefined;
        }
        const element = this.UI.createElement(
          doc,
          options.tag,
          options.namespace
        );

        let _DocumentFragment: typeof DocumentFragment;
        if (typeof DocumentFragment === "undefined") {
          _DocumentFragment = (doc as any).ownerGlobal.DocumentFragment;
        } else {
          _DocumentFragment = DocumentFragment;
        }
        if (!(element instanceof _DocumentFragment)) {
          if (options.id) {
            element.id = options.id;
          }
          if (options.styles && Object.keys(options.styles).length) {
            Object.keys(options.styles).forEach((k) => {
              const v = options.styles[k];
              typeof v !== "undefined" && (element.style[k] = v);
            });
          }
          if (
            options.directAttributes &&
            Object.keys(options.directAttributes).length
          ) {
            Object.keys(options.directAttributes).forEach((k) => {
              const v = options.directAttributes[k];
              typeof v !== "undefined" && (element[k] = v);
            });
          }
          if (options.attributes && Object.keys(options.attributes).length) {
            Object.keys(options.attributes).forEach((k) => {
              const v = options.attributes[k];
              typeof v !== "undefined" && element.setAttribute(k, String(v));
            });
          }
          if (options.listeners?.length) {
            options.listeners.forEach(([type, cbk, option]) => {
              typeof cbk !== "undefined" &&
                element.addEventListener(type, cbk, option);
            });
          }
        }

        if (options.subElementOptions?.length) {
          const subElements = options.subElementOptions
            .map((_options) => this.UI.creatElementsFromJSON(doc, _options))
            .filter((e) => e);
          element.append(...subElements);
        }
        return element;
      },
      defaultMenuPopupSelectors: {
        menuFile: "#menu_FilePopup",
        menuEdit: "#menu_EditPopup",
        menuView: "#menu_viewPopup",
        menuGo: "#menu_goPopup",
        menuTools: "#menu_ToolsPopup",
        menuHelp: "#menu_HelpPopup",
        collection: "#zotero-collectionmenu",
        item: "#zotero-itemmenu",
      },
      insertMenuItem: (
        menuPopup: XUL.Menupopup | string,
        options: MenuitemOptions,
        insertPosition: "before" | "after" = "after",
        anchorElement: XUL.Element = undefined
      ) => {
        const Zotero = this.Compat.getZotero();
        let popup: XUL.Menupopup;
        if (typeof menuPopup === "string") {
          if (
            !Object.keys(this.UI.defaultMenuPopupSelectors).includes(menuPopup)
          ) {
            return false;
          } else {
            popup = (Zotero.getMainWindow() as Window).document.querySelector(
              this.UI.defaultMenuPopupSelectors[menuPopup]
            );
          }
        } else {
          popup = menuPopup;
        }
        if (!popup) {
          return false;
        }
        const doc: Document = popup.ownerDocument;
        const generateElementOptions = (
          menuitemOption: MenuitemOptions
        ): ElementOptions => {
          let elementOption: ElementOptions = {
            tag: menuitemOption.tag,
            id: menuitemOption.id,
            namespace: "xul",
            attributes: {
              label: menuitemOption.label,
              hidden: Boolean(menuitemOption.hidden),
              disaled: Boolean(menuitemOption.disabled),
              class: menuitemOption.class || "",
              oncommand: menuitemOption.oncommand,
            },
            styles: menuitemOption.styles || {},
            listeners: [["command", menuitemOption.commandListener]],
            subElementOptions: [],
          };
          if (menuitemOption.icon) {
            elementOption.attributes["class"] += " menuitem-iconic";
            elementOption.styles[
              "list-style-image"
            ] = `url(${menuitemOption.icon})`;
          }
          if (menuitemOption.tag === "menu") {
            elementOption.subElementOptions.push({
              tag: "menupopup",
              id: menuitemOption.popupId,
              namespace: "xul",
              attributes: { onpopupshowing: menuitemOption.onpopupshowing },
              subElementOptions: menuitemOption.subElementOptions.map(
                generateElementOptions
              ),
            });
          }
          return elementOption;
        };
        const menuItem = this.UI.creatElementsFromJSON(
          doc,
          generateElementOptions(options)
        );
        if (!anchorElement) {
          anchorElement = (
            insertPosition === "after"
              ? popup.lastElementChild
              : popup.firstElementChild
          ) as XUL.Element;
        }
        anchorElement[insertPosition](menuItem);
      },
    };
  }
}

class CopyHelper {
  private transferable: any;
  private clipboardService: any;

  constructor() {
    this.transferable = Components.classes[
      "@mozilla.org/widget/transferable;1"
    ].createInstance(Components.interfaces.nsITransferable);
    this.clipboardService = Components.classes[
      "@mozilla.org/widget/clipboard;1"
    ].getService(Components.interfaces.nsIClipboard);
    this.transferable.init(null);
  }

  public addText(source: string, type: "text/html" | "text/unicode") {
    const str = Components.classes[
      "@mozilla.org/supports-string;1"
    ].createInstance(Components.interfaces.nsISupportsString);
    str.data = source;
    this.transferable.addDataFlavor(type);
    this.transferable.setTransferData(type, str, source.length * 2);
    return this;
  }

  public addImage(source: string) {
    let parts = source.split(",");
    if (!parts[0].includes("base64")) {
      return;
    }
    let mime = parts[0].match(/:(.*?);/)[1];
    let bstr = atob(parts[1]);
    let n = bstr.length;
    let u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    let imgTools = Components.classes["@mozilla.org/image/tools;1"].getService(
      Components.interfaces.imgITools
    );
    let imgPtr = Components.classes[
      "@mozilla.org/supports-interface-pointer;1"
    ].createInstance(Components.interfaces.nsISupportsInterfacePointer);
    imgPtr.data = imgTools.decodeImageFromArrayBuffer(u8arr.buffer, mime);
    this.transferable.addDataFlavor(mime);
    this.transferable.setTransferData(mime, imgPtr, 0);
    return this;
  }

  public copy() {
    this.clipboardService.setData(
      this.transferable,
      null,
      Components.interfaces.nsIClipboard.kGlobalClipboard
    );
  }
}

export default AddonUtils;
