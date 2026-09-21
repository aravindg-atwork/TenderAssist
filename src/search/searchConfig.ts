export interface ConfiguredSearch {
  searchKey: string;
  productCategory: string;
}

// Verified live 2026-09-21 against the real, authenticated TN Tenders
// Advanced Search page's Product Category dropdown (94 total values) -- all
// 7 of these exist verbatim as separate options. Computer- H/W is a real,
// separate option too, but is explicitly out of scope (hardware) -- do not
// add it back. See docs/superpowers/specs/2026-09-21-search-execution-design.md.
export const CONFIGURED_SEARCHES: ConfiguredSearch[] = [
  { searchKey: 'search_1', productCategory: 'Computer- S/W' },
  { searchKey: 'search_2', productCategory: 'Information Technology' },
  { searchKey: 'search_3', productCategory: 'Info. Tech. Services' },
  { searchKey: 'search_4', productCategory: 'Documentary film,Video film' },
  { searchKey: 'search_5', productCategory: 'Miscellaneous Goods' },
  { searchKey: 'search_6', productCategory: 'Miscellaneous Services' },
  { searchKey: 'search_7', productCategory: 'Miscellaneous Works' },
];
