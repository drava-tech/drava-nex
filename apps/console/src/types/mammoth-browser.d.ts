// mammoth ships types for its main entry only; the browser build has the same API.
declare module "mammoth/mammoth.browser" {
  import mammoth = require("mammoth")
  export = mammoth
}
