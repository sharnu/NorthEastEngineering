import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { KanbanService, KanbanBoardDto } from './kanban.service';

const FIXTURE_BOARD: KanbanBoardDto = {
  stations: [
    {
      stationId: 10,
      stationCode: 'MAT_PROC',
      stationName: 'Material Processing',
      ownerName: 'Marcus',
      cards: [
        {
          roId: 'aaaaaaaa-0000-0000-0000-000000000001',
          roNumber: 'RO00001',
          customerName: 'DFE',
          priority: 2,
          requiredDate: null,
          bodyType: 'TIPPER_CS',
          track: 'BODY',
          stationId: 10,
          stationCode: 'MAT_PROC',
          stationName: 'Material Processing',
          gateState: 'IN_PROGRESS',
          gateReason: null,
          estimatedHours: 8,
          actualHours: 0,
          totalTasks: 2,
          completedTasks: 0,
          sourcePdfUrl: null,
          hasManualOverride: false,
          tasks: [
            {
              id: 'bbbbbbbb-0000-0000-0000-000000000001',
              sequence: 1,
              jobCodeLine: 'TP42N-001',
              operationName: 'CNC + base',
              assignedToUserId: null,
              assignedToName: null,
              estimatedHours: 5.5,
              actualHours: 0,
              status: 'PENDING',
              flowTrack: 'BODY',
              notes: null,
            },
          ],
        },
      ],
    },
    {
      stationId: 20,
      stationCode: 'FAB_LINE',
      stationName: 'Fabrication Line',
      ownerName: null,
      cards: [],
    },
  ],
};

describe('KanbanService', () => {
  let service: KanbanService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service  = TestBed.inject(KanbanService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('parses a board response with two stations and a cards array', () => {
    let result: KanbanBoardDto | undefined;
    service.getBoard().subscribe(b => (result = b));

    const req = httpMock.expectOne('/api/kanban');
    req.flush(FIXTURE_BOARD);

    expect(result).toBeDefined();
    expect(result!.stations.length).toBe(2);
    expect(result!.stations[0].cards.length).toBe(1);
    expect(result!.stations[0].cards[0].roNumber).toBe('RO00001');
    expect(result!.stations[0].cards[0].tasks.length).toBe(1);
    expect(result!.stations[0].cards[0].tasks[0].flowTrack).toBe('BODY');
    expect(result!.stations[1].cards.length).toBe(0);
  });

  it('appends stationId query param when provided', () => {
    service.getBoard(20).subscribe();
    const req = httpMock.expectOne('/api/kanban?stationId=20');
    req.flush({ stations: [] });
    expect(req.request.method).toBe('GET');
  });

  it('refresh() updates boardSignal with fetched board', () => {
    expect(service.boardSignal()).toBeNull();
    service.refresh();
    const req = httpMock.expectOne('/api/kanban');
    req.flush(FIXTURE_BOARD);
    expect(service.boardSignal()).not.toBeNull();
    expect(service.boardSignal()!.stations.length).toBe(2);
  });
});
