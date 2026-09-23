export type PortalGroup = 'Central Government' | 'PSU / Other' | 'State / UT';
export type PortalCompatibility = 'VERIFIED' | 'BETA';

export interface PortalDefinition {
  id: string;
  name: string;
  group: PortalGroup;
  stateName: string;
  url: string;
  compatibility: PortalCompatibility;
}

/**
 * Official GePNIC participating-site directory, captured from the Government
 * of India ePublishing directory. Tamil Nadu is the currently verified
 * end-to-end adapter; the remaining sites share the NIC family and are exposed
 * as beta until their login/search/DSC flow is confirmed on a real account.
 */
export const PORTALS: readonly PortalDefinition[] = [
  { id: 'cppp-1', name: 'Central Public Procurement Portal 1', group: 'Central Government', stateName: 'Central Government', url: 'https://eprocure.gov.in/eprocure/app', compatibility: 'BETA' },
  { id: 'cppp-2', name: 'Central Public Procurement Portal 2', group: 'Central Government', stateName: 'Central Government', url: 'https://etenders.gov.in/eprocure/app', compatibility: 'BETA' },
  { id: 'defence', name: 'Defence eProcurement', group: 'Central Government', stateName: 'Central Government', url: 'https://defproc.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'pmgsy', name: 'PMGSY eProcurement', group: 'Central Government', stateName: 'Central Government', url: 'https://pmgsytenders.gov.in/nicgep/app', compatibility: 'BETA' },

  { id: 'bel', name: 'Bharat Electronics Limited (BEL)', group: 'PSU / Other', stateName: 'Central PSU', url: 'https://eprocurebel.co.in/nicgep/app', compatibility: 'BETA' },
  { id: 'bhel', name: 'Bharat Heavy Electricals Limited (BHEL)', group: 'PSU / Other', stateName: 'Central PSU', url: 'https://eprocurebhel.co.in/nicgep/app', compatibility: 'BETA' },
  { id: 'coal-india', name: 'Coal India Limited (CIL)', group: 'PSU / Other', stateName: 'Central PSU', url: 'https://coalindiatenders.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'cpcl', name: 'Chennai Petroleum Corporation Limited (CPCL)', group: 'PSU / Other', stateName: 'Tamil Nadu', url: 'https://cpcletenders.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'grse', name: 'Garden Reach Shipbuilders and Engineers (GRSE)', group: 'PSU / Other', stateName: 'Central PSU', url: 'https://eprocuregrse.co.in/nicgep/app', compatibility: 'BETA' },
  { id: 'gsl', name: 'Goa Shipyard Limited (GSL)', group: 'PSU / Other', stateName: 'Goa', url: 'https://eprocuregsl.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'hsl', name: 'Hindustan Shipyard Limited (HSL)', group: 'PSU / Other', stateName: 'Andhra Pradesh', url: 'https://eprocurehsl.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'iocl', name: 'IndianOil Corporation Limited (IOCL)', group: 'PSU / Other', stateName: 'Central PSU', url: 'https://iocletenders.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'mdl', name: 'Mazagon Dock Shipbuilders Limited (MDL)', group: 'PSU / Other', stateName: 'Maharashtra', url: 'https://eprocuremdl.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'midhani', name: 'Mishra Dhatu Nigam Limited (MIDHANI)', group: 'PSU / Other', stateName: 'Telangana', url: 'https://eprocuremidhani.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'ntpc', name: 'NTPC Limited', group: 'PSU / Other', stateName: 'Central PSU', url: 'https://eprocurentpc.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'beml', name: 'BEML Limited', group: 'PSU / Other', stateName: 'Central PSU', url: 'https://eprocurebeml.nic.in/nicgep/app', compatibility: 'BETA' },

  { id: 'andaman-nicobar', name: 'Andaman and Nicobar Islands', group: 'State / UT', stateName: 'Andaman and Nicobar Islands', url: 'https://eprocure.andamannicobar.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'arunachal-pradesh', name: 'Arunachal Pradesh', group: 'State / UT', stateName: 'Arunachal Pradesh', url: 'https://arunachaltenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'assam', name: 'Assam', group: 'State / UT', stateName: 'Assam', url: 'https://assamtenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'chandigarh', name: 'Chandigarh', group: 'State / UT', stateName: 'Chandigarh', url: 'https://etenders.chd.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'dadra-nagar-haveli', name: 'Dadra and Nagar Haveli', group: 'State / UT', stateName: 'Dadra and Nagar Haveli', url: 'https://dnhtenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'daman-diu', name: 'Daman and Diu', group: 'State / UT', stateName: 'Daman and Diu', url: 'https://ddtenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'delhi', name: 'NCT of Delhi', group: 'State / UT', stateName: 'Delhi', url: 'https://govtprocurement.delhi.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'goa', name: 'Goa', group: 'State / UT', stateName: 'Goa', url: 'https://eprocure.goa.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'haryana', name: 'Haryana', group: 'State / UT', stateName: 'Haryana', url: 'https://etenders.hry.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'himachal-pradesh', name: 'Himachal Pradesh', group: 'State / UT', stateName: 'Himachal Pradesh', url: 'https://hptenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'jammu-kashmir', name: 'Jammu and Kashmir', group: 'State / UT', stateName: 'Jammu and Kashmir', url: 'https://jktenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'jharkhand', name: 'Jharkhand', group: 'State / UT', stateName: 'Jharkhand', url: 'https://jharkhandtenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'kerala', name: 'Kerala', group: 'State / UT', stateName: 'Kerala', url: 'https://etenders.kerala.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'lakshadweep', name: 'Lakshadweep', group: 'State / UT', stateName: 'Lakshadweep', url: 'https://tendersutl.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'maharashtra', name: 'Maharashtra', group: 'State / UT', stateName: 'Maharashtra', url: 'https://mahatenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'madhya-pradesh', name: 'Madhya Pradesh', group: 'State / UT', stateName: 'Madhya Pradesh', url: 'https://mptenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'manipur', name: 'Manipur', group: 'State / UT', stateName: 'Manipur', url: 'https://manipurtenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'meghalaya', name: 'Meghalaya', group: 'State / UT', stateName: 'Meghalaya', url: 'https://meghalayatenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'mizoram', name: 'Mizoram', group: 'State / UT', stateName: 'Mizoram', url: 'https://mizoramtenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'nagaland', name: 'Nagaland', group: 'State / UT', stateName: 'Nagaland', url: 'https://nagalandtenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'odisha', name: 'Odisha', group: 'State / UT', stateName: 'Odisha', url: 'https://tendersodisha.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'puducherry', name: 'Puducherry', group: 'State / UT', stateName: 'Puducherry', url: 'https://pudutenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'punjab', name: 'Punjab', group: 'State / UT', stateName: 'Punjab', url: 'https://eproc.punjab.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'rajasthan', name: 'Rajasthan', group: 'State / UT', stateName: 'Rajasthan', url: 'https://eproc.rajasthan.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'sikkim', name: 'Sikkim', group: 'State / UT', stateName: 'Sikkim', url: 'https://sikkimtender.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'tamil-nadu', name: 'Tamil Nadu', group: 'State / UT', stateName: 'Tamil Nadu', url: 'https://tntenders.gov.in/nicgep/app', compatibility: 'VERIFIED' },
  { id: 'tripura', name: 'Tripura', group: 'State / UT', stateName: 'Tripura', url: 'https://tripuratenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'ladakh', name: 'Ladakh', group: 'State / UT', stateName: 'Ladakh', url: 'https://tenders.ladakh.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'uttarakhand', name: 'Uttarakhand', group: 'State / UT', stateName: 'Uttarakhand', url: 'https://uktenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'uttar-pradesh', name: 'Uttar Pradesh', group: 'State / UT', stateName: 'Uttar Pradesh', url: 'https://etender.up.nic.in/nicgep/app', compatibility: 'BETA' },
  { id: 'west-bengal', name: 'West Bengal', group: 'State / UT', stateName: 'West Bengal', url: 'https://wbtenders.gov.in/nicgep/app', compatibility: 'BETA' },
  { id: 'west-bengal-sdc', name: 'West Bengal — SDC', group: 'State / UT', stateName: 'West Bengal', url: 'https://tenders.wb.gov.in/nicgep/app', compatibility: 'BETA' },
] as const;

export const DEFAULT_PORTAL_ID = 'tamil-nadu';

export function getPortalDefinition(portalId?: string): PortalDefinition {
  return PORTALS.find((portal) => portal.id === portalId) ?? PORTALS.find((portal) => portal.id === DEFAULT_PORTAL_ID)!;
}

export function portalTargetPrefix(portal: PortalDefinition): string {
  const url = new URL(portal.url);
  const rootPath = url.pathname.replace(/\/app\/?$/i, '');
  return `${url.origin}${rootPath}`;
}

export function portalAllowedHosts(portal: PortalDefinition): string[] {
  const hostname = new URL(portal.url).hostname.toLocaleLowerCase();
  return hostname.startsWith('www.') ? [hostname, hostname.slice(4)] : [hostname, `www.${hostname}`];
}
