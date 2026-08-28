import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import {
  AdminService,
  AdminUser,
  CreatedInstrument,
  InstrumentImpact,
  MarketDataFetchResult,
  RemovedInstrument,
  RemovedUser,
  UserImpact,
} from './admin-panel.service';

describe('AdminService', () => {
  let service: AdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AdminService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('fetchMarketData POSTs the ticker and date range to the market-data endpoint', () => {
    service.fetchMarketData('^NDX', '2026-01-01', '2026-01-31').subscribe();

    const req = httpMock.expectOne('/api/admin/market-data');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ ticker: '^NDX', from: '2026-01-01', to: '2026-01-31' });
    req.flush({ ticker: '^NDX', from: '2026-01-01', to: '2026-01-31', daysWritten: 21 } satisfies MarketDataFetchResult);
  });

  it('addInstrument POSTs the full instrument payload to the instruments endpoint', () => {
    service.addInstrument('us_stock', 'ABC', 'Foo Corp', 'USD', true, '').subscribe();

    const req = httpMock.expectOne('/api/admin/instruments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      type: 'us_stock',
      ticker: 'ABC',
      name: 'Foo Corp',
      currency: 'USD',
      rsiEligible: true,
      suffix: '',
    });
    req.flush({
      ticker: 'ABC',
      name: 'Foo Corp',
      type: 'us_stock',
      rsiEligible: true,
      provider: 'yahoo',
      currency: 'USD',
      suffix: '',
    } satisfies CreatedInstrument);
  });

  it('getInstrumentImpact GETs the impact endpoint with the ticker URL-encoded', () => {
    service.getInstrumentImpact('BRK.B').subscribe();

    const req = httpMock.expectOne('/api/admin/instruments/BRK.B/impact');
    expect(req.request.method).toBe('GET');
    req.flush({ ticker: 'BRK.B', alertsCount: 0 } satisfies InstrumentImpact);
  });

  it('getInstrumentImpact URL-encodes a ticker containing reserved characters', () => {
    service.getInstrumentImpact('A/B').subscribe();

    const req = httpMock.expectOne('/api/admin/instruments/A%2FB/impact');
    req.flush({ ticker: 'A/B', alertsCount: 0 } satisfies InstrumentImpact);
  });

  it('removeInstrument DELETEs the instrument endpoint with the ticker URL-encoded', () => {
    service.removeInstrument('^NDX').subscribe();

    const req = httpMock.expectOne('/api/admin/instruments/%5ENDX');
    expect(req.request.method).toBe('DELETE');
    req.flush({ ticker: '^NDX', alertsDeleted: 3 } satisfies RemovedInstrument);
  });

  it('listUsers GETs the users endpoint and unwraps the users array from the response', () => {
    const users: AdminUser[] = [
      { id: 1, email: 'a@example.com' },
      { id: 2, email: 'b@example.com' },
    ];
    let received: AdminUser[] | undefined;
    service.listUsers().subscribe((value) => (received = value));

    const req = httpMock.expectOne('/api/admin/users');
    expect(req.request.method).toBe('GET');
    req.flush({ users });

    expect(received).toEqual(users);
  });

  it('getUserImpact GETs the user impact endpoint for the given id', () => {
    service.getUserImpact(42).subscribe();

    const req = httpMock.expectOne('/api/admin/users/42/impact');
    expect(req.request.method).toBe('GET');
    req.flush({ id: 42, email: 'a@example.com', alertsCount: 1, triggerEventsCount: 2 } satisfies UserImpact);
  });

  it('removeUser DELETEs the user endpoint for the given id', () => {
    service.removeUser(42).subscribe();

    const req = httpMock.expectOne('/api/admin/users/42');
    expect(req.request.method).toBe('DELETE');
    req.flush({
      id: 42,
      email: 'a@example.com',
      alertsDeleted: 1,
      triggerEventsDeleted: 2,
    } satisfies RemovedUser);
  });
});
