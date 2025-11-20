# Outstanding items vs. akkordseddel task list

- **ZIP feedback not updated for JSON:** `exportZip` now bundles CSV, PDF og JSON, men UI-beskeden siger stadig kun "PDF og CSV" efter download. 【F:main.js†L3722-L3753】
- **Demontage eksport mangler type i filnavn:** JSON-filer eksporteres altid som `<sagsnummer>.json` uden at markere montage/demontage, selv om kravet var at skelne tydeligt i filnavnene. 【F:main.js†L3418-L3441】
- **Planlagte E2E-/layouttests findes ikke:** `package.json` definerer kun HTML-validator, link-checker og Lighthouse-scripts; der er stadig ingen automatiske tests for layout-lock, "Vis valgte materialer", historik, ZIP-indhold, eller montage/demontage-import/eksport-flowet som beskrevet. 【F:package.json†L6-L18】
