import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { KanbanBoardComponent } from './kanban-board.component';
import { KanbanService, KanbanBoardDto, KanbanCardDto } from './kanban.service';
import { AuthService } from '../core/auth.service';

const MOCK_USER = {
  id: '11111111-1111-1111-1111-111111111111',
  fullName: 'Test Supervisor',
  roles: ['SUPERVISOR'],
};

const MOCK_CARD: KanbanCardDto = {
  roId: 'aaaaaaaa-0000-0000-0000-000000000001',
  roNumber: 'RO00001',
  customerName: 'DFE',
  priority: 2,
  requiredDate: null,
  bodyType: 'TIPPER_CS',
  track: 'BODY',
  stationId: 20,
  stationCode: 'FAB_LINE',
  stationName: 'Fab Line',
  gateState: 'IN_PROGRESS',
  gateReason: null,
  estimatedHours: 14,
  actualHours: 0,
  totalTasks: 4,
  completedTasks: 0,
  sourcePdfUrl: null,
  hasManualOverride: false,
  tasks: [],
};

const MOCK_BOARD: KanbanBoardDto = {
  stations: [
    {
      stationId: 10,
      stationCode: 'PAINT',
      stationName: 'Paint',
      ownerName: null,
      cards: [],
    },
    {
      stationId: 20,
      stationCode: 'FAB_LINE',
      stationName: 'Fab Line',
      ownerName: 'Peter Rogers',
      cards: [],
    },
  ],
};

function buildSvc(spy: jasmine.Spy) {
  return { getBoard: spy, getTechnicians: jasmine.createSpy(), assignTask: jasmine.createSpy() };
}

describe('KanbanBoardComponent', () => {
  let getBoardSpy: jasmine.Spy;

  beforeEach(() => {
    getBoardSpy = jasmine.createSpy('getBoard').and.returnValue(of(MOCK_BOARD));

    TestBed.configureTestingModule({
      imports: [KanbanBoardComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: KanbanService, useValue: buildSvc(getBoardSpy) },
        {
          provide: AuthService,
          useValue: {
            user: () => MOCK_USER,
            logout: jasmine.createSpy(),
            isAuthenticated: jasmine.createSpy().and.returnValue(true),
          },
        },
      ],
    });
  });

  it('calls getBoard() once on initial load', fakeAsync(() => {
    const fixture = TestBed.createComponent(KanbanBoardComponent);
    fixture.detectChanges();
    tick(0);
    expect(getBoardSpy).toHaveBeenCalledTimes(1);
    fixture.destroy();
  }));

  it('calls getBoard() a second time after 30 seconds', fakeAsync(() => {
    const fixture = TestBed.createComponent(KanbanBoardComponent);
    fixture.detectChanges();
    tick(0);
    tick(30_000);
    expect(getBoardSpy).toHaveBeenCalledTimes(2);
    fixture.destroy();
  }));

  it('renders one column per station from mock data', fakeAsync(() => {
    const fixture = TestBed.createComponent(KanbanBoardComponent);
    fixture.detectChanges();
    tick(0);
    fixture.detectChanges();

    const cols: NodeListOf<Element> =
      fixture.nativeElement.querySelectorAll('.board-col');
    expect(cols.length).toBe(MOCK_BOARD.stations.length);
    fixture.destroy();
  }));

  it('passes stationId param to getBoard when station filter is set', fakeAsync(() => {
    const fixture = TestBed.createComponent(KanbanBoardComponent);
    fixture.detectChanges();
    tick(0);
    getBoardSpy.calls.reset();

    fixture.componentInstance.onStationFilter('20');
    tick(0);

    expect(getBoardSpy).toHaveBeenCalledWith(20);
    fixture.destroy();
  }));

  it('renders one station-card per card in station.cards', fakeAsync(() => {
    const boardWithCards: KanbanBoardDto = {
      stations: [
        {
          stationId: 20,
          stationCode: 'FAB_LINE',
          stationName: 'Fab Line',
          ownerName: null,
          cards: [
            MOCK_CARD,
            { ...MOCK_CARD, roId: 'aaaaaaaa-0000-0000-0000-000000000002', roNumber: 'RO00002' },
          ],
        },
      ],
    };
    getBoardSpy.and.returnValue(of(boardWithCards));

    const fixture = TestBed.createComponent(KanbanBoardComponent);
    fixture.detectChanges();
    tick(0);
    fixture.detectChanges();

    const cards = fixture.nativeElement.querySelectorAll('app-station-card');
    expect(cards.length).toBe(2);
    fixture.destroy();
  }));
});
