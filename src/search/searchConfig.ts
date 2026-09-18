export interface ConfiguredSearch {
  searchKey: string;
  productCategory: string;
}

// Verified 2026-09-17 against the real TN Tenders Advanced Search page's
// Product Category dropdown (99 total values) -- these 7 are the exact
// values matching the spec's "5 categories -> 7 searches" model, where
// Miscellaneous is split across Goods/Services/Works.
export const CONFIGURED_SEARCHES: ConfiguredSearch[] = [
  { searchKey: 'search_1', productCategory: 'Computer- H/W' },
  { searchKey: 'search_2', productCategory: 'Computer- S/W' },
  { searchKey: 'search_3', productCategory: 'Information Technology' },
  { searchKey: 'search_4', productCategory: 'Info. Tech. Services' },
  { searchKey: 'search_5', productCategory: 'Miscellaneous Goods' },
  { searchKey: 'search_6', productCategory: 'Miscellaneous Services' },
  { searchKey: 'search_7', productCategory: 'Miscellaneous Works' },
];
