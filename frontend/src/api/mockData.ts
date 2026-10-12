/**
 * PLACEHOLDER DATA ONLY.
 *
 * The business routes currently return HTTP 501 Not Implemented. This file
 * exists only so the page layouts can be seen and reviewed with realistic
 * shapes in place.
 *
 * Rules this file follows:
 *
 * - it is local to the frontend and used by nothing else;
 * - every value is obviously a placeholder, and every sample company and agency
 *   name is prefixed with `(sample)` so it can never be mistaken for real data;
 * - it uses only fields the API returns, so no invented field is introduced;
 * - it is removed, together with the pages' import of it, once the routes return
 *   real data.
 *
 * Nothing here is real data, and no page presents it as such.
 */

import type {
  AgencySupplierItem,
  CompanyDetail,
  CompanySummary,
  IndustryAwardChild,
  SavedListDetail,
  SavedListSummary,
} from './client'

/** The note every page shows when it displays this file's values. */
export const PLACEHOLDER_NOTICE =
  'Sample values for layout review. The route returns HTTP 501 until it is implemented.'

/**
 * Registry status labels used by the status filter while
 * `GET /api/company-statuses` returns 501. These are real registry status
 * values from the source data, not company search results.
 */
export const PLACEHOLDER_COMPANY_STATUSES: string[] = [
  'Live Company',
  'Live (Dissolved)',
  'Struck Off',
  'In Liquidation',
  'Registered',
]

/** Agency names for the agency selector while `GET /api/agencies` returns 501. */
export const PLACEHOLDER_AGENCIES: string[] = [
  '(sample) Ministry of Example Works',
  '(sample) Example Health Authority',
  '(sample) Sample Land Transport Authority',
  '(sample) National Example Water Agency',
  '(sample) Example Digital Government Office',
]

/**
 * SSIC parents for the industry filter while `GET /api/industries` returns 501.
 * Codes and titles follow the SSIC section shape; the values are placeholders.
 */
export const PLACEHOLDER_INDUSTRY_PARENTS: { code: string; title: string }[] = [
  { code: 'F', title: 'Construction' },
  { code: 'G', title: 'Wholesale and Retail Trade' },
  { code: 'H', title: 'Transportation and Storage' },
  { code: 'J', title: 'Information and Communications' },
  { code: 'M', title: 'Professional, Scientific and Technical Activities' },
]

/** Twelve sample company rows, enough to show three pages of five. */
export const PLACEHOLDER_COMPANIES: CompanySummary[] = [
  {
    uen: 'SAMPLE0001A',
    name: '(sample) Alpha Builders Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2011-03-14',
    primary_activity: {
      code: '41001',
      title: 'General contractors (building construction)',
      source_description: 'GENERAL BUILDING CONSTRUCTION',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0002B',
    name: '(sample) Beta Engineering Services Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2014-07-02',
    primary_activity: {
      code: '71121',
      title: 'Engineering design and consultancy',
      source_description: 'ENGINEERING DESIGN SERVICES',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0003C',
    name: '(sample) Gamma InfoTech Solutions Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2017-01-19',
    primary_activity: {
      code: '62010',
      title: 'Computer programming activities',
      source_description: 'SOFTWARE DEVELOPMENT',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0004D',
    name: '(sample) Delta Facilities Management Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2009-11-30',
    primary_activity: {
      code: '81100',
      title: 'Combined facilities support activities',
      source_description: 'FACILITIES MANAGEMENT',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0005E',
    name: '(sample) Epsilon Logistics Pte Ltd',
    status: 'Struck Off',
    incorporation_date: '2006-05-08',
    primary_activity: {
      code: '52241',
      title: 'Freight transport arrangement',
      source_description: 'FREIGHT FORWARDING',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0006F',
    name: '(sample) Zeta Medical Supplies Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2019-09-23',
    primary_activity: {
      code: '46462',
      title: 'Wholesale of medical and orthopaedic goods',
      source_description: 'MEDICAL SUPPLIES WHOLESALE',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0007G',
    name: '(sample) Eta Environmental Consultants Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2013-02-11',
    primary_activity: {
      code: '39000',
      title: 'Remediation and other waste management services',
      source_description: 'ENVIRONMENTAL REMEDIATION',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0008H',
    name: '(sample) Theta Security Services Pte Ltd',
    status: 'In Liquidation',
    incorporation_date: '2008-08-15',
    primary_activity: {
      code: '80100',
      title: 'Private security activities',
      source_description: 'SECURITY SERVICES',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0009J',
    name: '(sample) Iota Catering Group Pte Ltd',
    status: 'Live (Dissolved)',
    incorporation_date: '2015-04-27',
    primary_activity: {
      code: '56210',
      title: 'Event catering',
      source_description: 'EVENT CATERING SERVICES',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0010K',
    name: '(sample) Kappa Electrical Works Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2012-06-05',
    primary_activity: {
      code: '43210',
      title: 'Electrical installation',
      source_description: 'ELECTRICAL WORKS',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0011L',
    name: '(sample) Lambda Training Academy Pte Ltd',
    status: 'Registered',
    incorporation_date: '2021-10-12',
    primary_activity: {
      code: '85499',
      title: 'Other education not elsewhere classified',
      source_description: 'PROFESSIONAL TRAINING',
    },
    has_linked_award: null,
  },
  {
    uen: 'SAMPLE0012M',
    name: '(sample) Mu Marine Works Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2010-12-01',
    primary_activity: {
      code: '30110',
      title: 'Building of ships and floating structures',
      source_description: 'SHIPBUILDING AND REPAIR',
    },
    has_linked_award: null,
  },
]

/**
 * Sample company detail records keyed by UEN.
 *
 * Former names are names only. No effective-from or effective-to dates are
 * returned, so none are invented here.
 */
export const PLACEHOLDER_COMPANY_DETAILS: Record<string, CompanyDetail> = {
  SAMPLE0001A: {
    uen: 'SAMPLE0001A',
    name: '(sample) Alpha Builders Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2011-03-14',
    address: {
      type: 'REGISTERED',
      block: '3018',
      street_name: 'SAMPLE BEDOK NORTH AVENUE 4',
      level_no: '#05',
      unit_no: '12',
      building_name: '(sample) Example Industrial Building',
      postal_code: '489947',
      other_address_line1: null,
      other_address_line2: null,
    },
    former_names: ['(sample) Alpha Construction', '(sample) Alpha Builders & Co'],
    activities: {
      primary: {
        code: '41001',
        title: 'General contractors (building construction)',
        source_description: 'GENERAL BUILDING CONSTRUCTION',
      },
      secondary: {
        code: '43301',
        title: 'Renovation contractors',
        source_description: 'RENOVATION CONTRACTORS',
      },
    },
    has_linked_award: null,
  },
  SAMPLE0002B: {
    uen: 'SAMPLE0002B',
    name: '(sample) Beta Engineering Services Pte Ltd',
    status: 'Live Company',
    incorporation_date: '2014-07-02',
    address: {
      type: 'REGISTERED',
      block: '21',
      street_name: 'SAMPLE TANNERY LANE',
      level_no: '#08',
      unit_no: '03',
      building_name: '(sample) Example Industrial Centre',
      postal_code: '347777',
      other_address_line1: null,
      other_address_line2: null,
    },
    former_names: ['(sample) Beta Engineering Consultancy'],
    activities: {
      primary: {
        code: '71121',
        title: 'Engineering design and consultancy',
        source_description: 'ENGINEERING DESIGN SERVICES',
      },
      secondary: null,
    },
    has_linked_award: null,
  },
}

/**
 * One page of sample supplier rows for the agency comparison layout.
 * `share_percent` is a decimal string, matching the API's value rule.
 */
export const PLACEHOLDER_AGENCY_SUPPLIERS: AgencySupplierItem[] = [
  {
    supplier_name: '(sample) Alpha Builders Pte Ltd',
    total_award_amount: '4820000.00',
    award_row_count: 9,
    tender_count: 7,
    share_percent: '24.16',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Beta Engineering Services Pte Ltd',
    total_award_amount: '3915000.00',
    award_row_count: 8,
    tender_count: 6,
    share_percent: '19.62',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Gamma InfoTech Solutions Pte Ltd',
    total_award_amount: '2740000.00',
    award_row_count: 6,
    tender_count: 5,
    share_percent: '13.73',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Delta Facilities Management Pte Ltd',
    total_award_amount: '2188000.00',
    award_row_count: 5,
    tender_count: 4,
    share_percent: '10.97',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Kappa Electrical Works Pte Ltd',
    total_award_amount: '1645000.00',
    award_row_count: 4,
    tender_count: 4,
    share_percent: '8.24',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Eta Environmental Consultants Pte Ltd',
    total_award_amount: '1210000.00',
    award_row_count: 3,
    tender_count: 3,
    share_percent: '6.07',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Mu Marine Works Pte Ltd',
    total_award_amount: '1125000.00',
    award_row_count: 3,
    tender_count: 2,
    share_percent: '5.64',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Zeta Medical Supplies Pte Ltd',
    total_award_amount: '940000.00',
    award_row_count: 2,
    tender_count: 2,
    share_percent: '4.71',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Theta Security Services Pte Ltd',
    total_award_amount: '742000.00',
    award_row_count: 2,
    tender_count: 2,
    share_percent: '3.72',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
  {
    supplier_name: '(sample) Lambda Training Academy Pte Ltd',
    total_award_amount: '628000.00',
    award_row_count: 2,
    tender_count: 1,
    share_percent: '3.14',
    company_link: { status: 'not_accepted', uen: null, name: null },
  },
]

/** Totals that match the sample supplier rows above. */
export const PLACEHOLDER_AGENCY_SUMMARY = {
  supplier_count: 10,
  tender_count: 36,
  total_award_amount: '19950000.00',
  excluded_no_supplier_tender_count: 47,
}

/**
 * Sample industry branch rows.
 *
 * The Industry Awards page does not display these, because it shows the
 * unavailable state rather than invented analytics. The values are kept only as
 * the response shape the endpoint will fill.
 */
export const PLACEHOLDER_INDUSTRY_BRANCHES: IndustryAwardChild[] = []

/** Sample saved lists for the two-panel layout. */
export const PLACEHOLDER_SAVED_LISTS: SavedListSummary[] = [
  { id: 'sample-list-1', name: '(sample) Potential suppliers', entry_count: 3 },
  { id: 'sample-list-2', name: '(sample) Reviewed construction suppliers', entry_count: 2 },
]

/** Sample entries for the first saved list. */
export const PLACEHOLDER_SAVED_LIST_ENTRIES: Record<string, SavedListDetail> = {
  'sample-list-1': {
    id: 'sample-list-1',
    name: '(sample) Potential suppliers',
    entry_count: 3,
    entries: [
      {
        company_uen: 'SAMPLE0001A',
        company_name: '(sample) Alpha Builders Pte Ltd',
        company_status: 'Live Company',
        review_status: 'to_check',
      },
      {
        company_uen: 'SAMPLE0003C',
        company_name: '(sample) Gamma InfoTech Solutions Pte Ltd',
        company_status: 'Live Company',
        review_status: 'reviewed',
      },
      {
        company_uen: 'SAMPLE0005E',
        company_name: '(sample) Epsilon Logistics Pte Ltd',
        company_status: 'Struck Off',
        review_status: 'to_check',
      },
    ],
  },
  'sample-list-2': {
    id: 'sample-list-2',
    name: '(sample) Reviewed construction suppliers',
    entry_count: 2,
    entries: [
      {
        company_uen: 'SAMPLE0001A',
        company_name: '(sample) Alpha Builders Pte Ltd',
        company_status: 'Live Company',
        review_status: 'reviewed',
      },
      {
        company_uen: 'SAMPLE0010K',
        company_name: '(sample) Kappa Electrical Works Pte Ltd',
        company_status: 'Live Company',
        review_status: 'reviewed',
      },
    ],
  },
}
