import { describe, expect, it } from 'vitest'
import { headerFullName, headerName, profileCompanyIsWorkspace } from './headerName.ts'

describe('headerName', () => {
  it('prefers the workspace name', () => {
    expect(headerName('Harlow Construction', 'Harlow Construction Company', 'Casey Harlow')).toBe('Harlow Construction')
  })

  it('falls back to the company name without a trailing Company', () => {
    expect(headerName(null, 'Harlow Construction Company', null)).toBe('Harlow Construction')
  })

  it('drops a trailing Co.', () => {
    expect(headerName(null, 'Shyld Roofing Co.', null)).toBe('Shyld Roofing')
  })

  it('drops a trailing LLC and the comma before it', () => {
    expect(headerName('Ridge Line Builders, LLC', null, null)).toBe('Ridge Line Builders')
  })

  it('falls back to the person', () => {
    expect(headerName(null, null, 'Casey Harlow')).toBe('Casey Harlow')
  })

  it('says Your company when nothing is set', () => {
    expect(headerName('', '  ', null)).toBe('Your company')
  })

  it('keeps a name that is only the suffix word', () => {
    expect(headerName('Company', null, null)).toBe('Company')
  })

  it('leaves the suffix words alone in the middle of a name', () => {
    expect(headerName('Company Store Remodeling', null, null)).toBe('Company Store Remodeling')
  })

  // The legal word goes only when what is left is a name on its own.
  // "My Company" is the name the server gives a workspace made without one
  // (migrations 032 and 062), so it must never read "My".
  it('keeps the whole name when dropping the legal word would leave only My, The or a word like it', () => {
    expect(headerName('My Company', 'Harlow Construction Company', 'Casey Harlow')).toBe('My Company')
    expect(headerName('The Company', null, null)).toBe('The Company')
    expect(headerName('Our Co.', null, null)).toBe('Our Co.')
  })

  // A one word name is still a name: the Phase 2 rule drops the legal word.
  it('drops the legal word after a one word name', () => {
    expect(headerName(null, 'Acme LLC', null)).toBe('Acme')
    expect(headerName('Shyld Co.', null, null)).toBe('Shyld')
    expect(headerFullName(null, 'Acme LLC', null)).toBe('Acme LLC')
  })

  it('keeps the whole name when the legal word follows and, & or +', () => {
    expect(headerName('Smith & Co.', null, null)).toBe('Smith & Co.')
    expect(headerName('Jones and Company', null, null)).toBe('Jones and Company')
    expect(headerName('Smith, Jones, & Co.', null, null)).toBe('Smith, Jones, & Co.')
    expect(headerName('Rock + Company', null, null)).toBe('Rock + Company')
  })

  it('keeps the whole name when an article or a word like My opens the phrase the legal word ends', () => {
    expect(headerName('The Fence Company', null, null)).toBe('The Fence Company')
    expect(headerName('My Roofing Co.', null, null)).toBe('My Roofing Co.')
    expect(headerName('Our Family Company', null, null)).toBe('Our Family Company')
  })

  it('still drops the legal word after a name with and or & inside it', () => {
    expect(headerName('Jones & Sons Company', null, null)).toBe('Jones & Sons')
    expect(headerName('Smith and Sons Co.', null, null)).toBe('Smith and Sons')
  })
})

// The desktop sidebar shows headerName and puts this in its title, so a
// name cut to two lines, or shortened, can still be read in full.
describe('headerFullName', () => {
  it('is the company name the profile spells out when it shortens to the name shown', () => {
    expect(headerFullName('Harlow Construction', 'Harlow Construction Company', 'Casey Harlow')).toBe('Harlow Construction Company')
  })

  it('reads the two names without minding case', () => {
    expect(headerFullName('harlow construction', 'Harlow Construction Company', null)).toBe('Harlow Construction Company')
  })

  it('keeps the legal word the short name dropped', () => {
    expect(headerFullName('Ridge Line Builders, LLC', null, null)).toBe('Ridge Line Builders, LLC')
    expect(headerFullName(null, 'Shyld Roofing Co.', null)).toBe('Shyld Roofing Co.')
  })

  it('stays with the workspace name when the profile names another company', () => {
    expect(headerFullName('Shyld', 'Harlow Construction Company', null)).toBe('Shyld')
  })

  it('keeps a long name whole', () => {
    const long = 'Harlow Construction and Concrete Restoration of Middle Tennessee'
    expect(headerFullName(long, null, null)).toBe(long)
  })

  it('falls back to the person, then to Your company', () => {
    expect(headerFullName(null, null, 'Casey Harlow')).toBe('Casey Harlow')
    expect(headerFullName('', '  ', null)).toBe('Your company')
  })

  it('is the name shown when that name keeps its legal word', () => {
    expect(headerFullName('My Company', 'Harlow Construction Company', 'Casey Harlow')).toBe('My Company')
    expect(headerFullName('Smith & Co.', null, null)).toBe('Smith & Co.')
  })
})

// The profile belongs to the person, not the workspace: its city and logo
// are the company the person runs. The desktop sidebar shows them beside
// the workspace name only when that company is the workspace.
describe('profileCompanyIsWorkspace', () => {
  it('is the workspace while there is no workspace name, since the name shown is the profile\'s', () => {
    expect(profileCompanyIsWorkspace({ orgName: null, companyName: 'Shyld Roofing Co.', ownsWorkspace: false, workspacesOwned: 0 })).toBe(true)
    expect(profileCompanyIsWorkspace({ orgName: '  ', companyName: null, ownsWorkspace: false, workspacesOwned: 0 })).toBe(true)
  })

  it('is the workspace when its company name shortens to the workspace name, in any case', () => {
    expect(profileCompanyIsWorkspace({ orgName: 'Harlow Construction', companyName: 'Harlow Construction Company', ownsWorkspace: false, workspacesOwned: 0 })).toBe(true)
    expect(profileCompanyIsWorkspace({ orgName: 'HARLOW CONSTRUCTION, LLC', companyName: 'Harlow Construction Co.', ownsWorkspace: false, workspacesOwned: 0 })).toBe(true)
  })

  it('matches names that differ only in the legal word, even one the name shown keeps', () => {
    expect(profileCompanyIsWorkspace({ orgName: 'Smith & Co.', companyName: 'Smith & Company', ownsWorkspace: false, workspacesOwned: 0 })).toBe(true)
    expect(profileCompanyIsWorkspace({ orgName: 'The Fence Co.', companyName: 'The Fence Company', ownsWorkspace: false, workspacesOwned: 0 })).toBe(true)
  })

  it('is not a workspace someone else owns', () => {
    // The owner runs Shyld Roofing and works crew at Harlow Construction.
    expect(profileCompanyIsWorkspace({ orgName: 'Harlow Construction', companyName: 'Shyld Roofing Co.', ownsWorkspace: false, workspacesOwned: 1 })).toBe(false)
    expect(profileCompanyIsWorkspace({ orgName: 'Harlow Construction', companyName: null, ownsWorkspace: false, workspacesOwned: 0 })).toBe(false)
  })

  it('is the one workspace the person owns, even under a name that no longer matches', () => {
    expect(profileCompanyIsWorkspace({ orgName: 'Harlow', companyName: 'Harlow Concrete and Stone', ownsWorkspace: true, workspacesOwned: 1 })).toBe(true)
  })

  it('needs the names to agree for someone who owns more than one workspace', () => {
    expect(profileCompanyIsWorkspace({ orgName: 'Harlow Construction', companyName: 'Shyld Roofing Co.', ownsWorkspace: true, workspacesOwned: 2 })).toBe(false)
    expect(profileCompanyIsWorkspace({ orgName: 'Shyld Roofing', companyName: 'Shyld Roofing Co.', ownsWorkspace: true, workspacesOwned: 2 })).toBe(true)
  })
})
