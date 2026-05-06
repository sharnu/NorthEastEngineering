import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StationCardComponent } from './station-card.component';
import { KanbanCardDto } from './kanban.service';

function makeCard(overrides: Partial<KanbanCardDto> = {}): KanbanCardDto {
  return {
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
    sourcePdfUrl: '/uploads/test.pdf',
    hasManualOverride: false,
    tasks: [
      { id: 't1', sequence: 1, jobCodeLine: 'L1', operationName: 'Op 1', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
      { id: 't2', sequence: 2, jobCodeLine: 'L2', operationName: 'Op 2', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
      { id: 't3', sequence: 3, jobCodeLine: 'L3', operationName: 'Op 3', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
      { id: 't4', sequence: 4, jobCodeLine: 'L4', operationName: 'Op 4', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
      { id: 't5', sequence: 5, jobCodeLine: 'L5', operationName: 'Op 5', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
      { id: 't6', sequence: 6, jobCodeLine: 'L6', operationName: 'Op 6', assignedToUserId: null, assignedToName: null, estimatedHours: 2, actualHours: 0, status: 'PENDING', flowTrack: 'BODY', notes: null },
    ],
    ...overrides,
  };
}

describe('StationCardComponent', () => {
  let fixture: ComponentFixture<StationCardComponent>;

  function create(card: KanbanCardDto): ComponentFixture<StationCardComponent> {
    TestBed.configureTestingModule({ imports: [StationCardComponent] });
    const f = TestBed.createComponent(StationCardComponent);
    f.componentRef.setInput('card', card);
    f.detectChanges();
    return f;
  }

  it('shows green left bar (ready class on host) when gateState is READY', () => {
    fixture = create(makeCard({ gateState: 'READY' }));
    expect(fixture.nativeElement.classList.contains('ready')).toBeTrue();
    expect(fixture.nativeElement.classList.contains('gated')).toBeFalse();
  });

  it('shows dashed hatched style (gated class on host) when gateState is GATED', () => {
    fixture = create(makeCard({ gateState: 'GATED', gateReason: 'Waiting for chassis' }));
    expect(fixture.nativeElement.classList.contains('gated')).toBeTrue();
    expect(fixture.nativeElement.classList.contains('ready')).toBeFalse();
  });

  it('emits pdfClick without bubbling to cardClick', () => {
    fixture = create(makeCard());
    let cardClicked = false;
    let pdfClicked  = false;
    fixture.componentInstance.cardClick.subscribe(() => (cardClicked = true));
    fixture.componentInstance.pdfClick.subscribe(() => (pdfClicked = true));

    const pdfBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.stn-pdf-btn');
    pdfBtn.click();
    fixture.detectChanges();

    expect(pdfClicked).toBeTrue();
    expect(cardClicked).toBeFalse();
  });

  it('truncates mini tasks at 4 and shows +N more', () => {
    fixture = create(makeCard()); // 6 tasks
    const taskRows = fixture.nativeElement.querySelectorAll('.stn-task-mini');
    // 4 visible + 1 "more" row = 5 elements
    expect(taskRows.length).toBe(5);
    const moreRow = fixture.nativeElement.querySelector('.stn-task-mini-more');
    expect(moreRow).not.toBeNull();
    expect(moreRow!.textContent).toContain('2 more');
  });

  it('renders the body-type chip with the short code', () => {
    fixture = create(makeCard({ bodyType: 'TAUTLINER' }));
    const chip: HTMLElement = fixture.nativeElement.querySelector('.stn-card-body-type');
    expect(chip.textContent?.trim()).toBe('TAUT');
  });
});
