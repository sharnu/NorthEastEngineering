using Microsoft.EntityFrameworkCore;
using Nee.Api.Domain;
using Nee.Api.Endpoints;

namespace Nee.Api.Data;

public class NeeDbContext : DbContext
{
    public NeeDbContext(DbContextOptions<NeeDbContext> options) : base(options) { }

    // Identity
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<UserRole> UserRoles => Set<UserRole>();

    // Master data
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<BodyType> BodyTypes => Set<BodyType>();
    public DbSet<JobType> JobTypes => Set<JobType>();
    public DbSet<Station> Stations => Set<Station>();
    public DbSet<StationTechnician> StationTechnicians => Set<StationTechnician>();
    public DbSet<OperationCatalog> OperationCatalog => Set<OperationCatalog>();

    // Template catalog
    public DbSet<JobCodeTemplate> JobCodeTemplates => Set<JobCodeTemplate>();
    public DbSet<TemplateVersion> TemplateVersions => Set<TemplateVersion>();
    public DbSet<TemplateOperation> TemplateOperations => Set<TemplateOperation>();

    // Repair orders
    public DbSet<RepairOrder> RepairOrders => Set<RepairOrder>();
    public DbSet<JobTask> JobTasks => Set<JobTask>();

    // Production
    public DbSet<KanbanStage> KanbanStages => Set<KanbanStage>();
    public DbSet<RoKanbanState> RoKanbanStates => Set<RoKanbanState>();
    public DbSet<VarianceReason> VarianceReasons => Set<VarianceReason>();
    public DbSet<VarianceRecord> VarianceRecords => Set<VarianceRecord>();
    public DbSet<TimeEntry> TimeEntries => Set<TimeEntry>();

    // QC
    public DbSet<QcSubmission> QcSubmissions => Set<QcSubmission>();
    public DbSet<QcChecklistItem> QcChecklistItems => Set<QcChecklistItem>();
    public DbSet<QcResult> QcResults => Set<QcResult>();

    // Notifications
    public DbSet<Notification> Notifications => Set<Notification>();

    // Attachments
    public DbSet<Attachment> Attachments => Set<Attachment>();

    // Flow definitions
    public DbSet<FlowDefinition> FlowDefinitions => Set<FlowDefinition>();

    // Scheduling
    public DbSet<ChassisInventory> ChassisInventory => Set<ChassisInventory>();
    public DbSet<CustomerApproval> CustomerApprovals => Set<CustomerApproval>();
    public DbSet<ChassisStockUpload> ChassisStockUploads => Set<ChassisStockUpload>();

    // Audit
    public DbSet<DomainEvent> DomainEvents => Set<DomainEvent>();

    protected override void OnModelCreating(ModelBuilder mb)
    {
        // UseSnakeCaseNamingConvention() in Program.cs handles most mappings automatically.
        // Explicit config only where convention doesn't fit.

        // --- Identity ---
        mb.Entity<User>(b =>
        {
            b.ToTable("users");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.HasIndex(x => x.Username).IsUnique();
            b.HasIndex(x => x.Email).IsUnique();
        });

        mb.Entity<Role>(b =>
        {
            b.ToTable("roles");
            b.HasKey(x => x.Id);
            b.HasIndex(x => x.Code).IsUnique();
        });

        mb.Entity<UserRole>(b =>
        {
            b.ToTable("user_roles");
            b.HasKey(x => new { x.UserId, x.RoleId });
            b.HasOne(x => x.User).WithMany(u => u.UserRoles).HasForeignKey(x => x.UserId);
            b.HasOne(x => x.Role).WithMany(r => r.UserRoles).HasForeignKey(x => x.RoleId);
        });

        // --- Master data ---
        mb.Entity<Customer>(b =>
        {
            b.ToTable("customers");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
        });

        mb.Entity<BodyType>(b =>
        {
            b.ToTable("body_types");
            b.HasKey(x => x.Id);
        });

        mb.Entity<JobType>(b =>
        {
            b.ToTable("job_types");
            b.HasKey(x => x.Id);
        });

        mb.Entity<Station>(b =>
        {
            b.ToTable("stations");
            b.HasKey(x => x.Id);
            b.HasOne(x => x.OwnerUser).WithMany().HasForeignKey(x => x.OwnerUserId);
            b.Ignore(x => x.Operations);
        });

        mb.Entity<StationTechnician>(b =>
        {
            b.ToTable("station_technicians");
            b.HasKey(x => new { x.StationId, x.UserId });
            b.Property(x => x.SkillLevel).HasColumnName("skill_level");
            b.HasOne(x => x.Station).WithMany(s => s.Technicians).HasForeignKey(x => x.StationId);
            b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId);
        });

        mb.Entity<OperationCatalog>(b =>
        {
            b.ToTable("operation_catalog");
            b.HasKey(x => x.Id);
            b.HasOne(x => x.DefaultStation)
             .WithMany()
             .HasForeignKey(x => x.DefaultStationId);
        });

        // --- Template catalog ---
        mb.Entity<JobCodeTemplate>(b =>
        {
            b.ToTable("job_code_templates");
            b.HasKey(x => x.Code);
            b.HasOne(x => x.BodyType).WithMany().HasForeignKey(x => x.BodyTypeId);
            b.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
        });

        mb.Entity<TemplateVersion>(b =>
        {
            b.ToTable("template_versions");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.HasOne(x => x.Template)
             .WithMany(t => t.Versions)
             .HasForeignKey(x => x.TemplateCode);
        });

        mb.Entity<TemplateOperation>(b =>
        {
            b.ToTable("template_operations");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.HasOne(x => x.TemplateVersion)
             .WithMany(v => v.Operations)
             .HasForeignKey(x => x.TemplateVersionId);
            b.HasOne(x => x.Operation)
             .WithMany()
             .HasForeignKey(x => x.OperationId);
        });

        // --- Repair orders ---
        mb.Entity<RepairOrder>(b =>
        {
            b.ToTable("repair_orders");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId);
            b.HasOne(x => x.Template).WithMany().HasForeignKey(x => x.TemplateCode);
            b.HasOne(x => x.TemplateVersion).WithMany().HasForeignKey(x => x.TemplateVersionId);
            b.HasOne(x => x.JobType).WithMany().HasForeignKey(x => x.JobTypeId);
        });

        mb.Entity<JobTask>(b =>
        {
            b.ToTable("job_tasks");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.HasOne(x => x.RepairOrder)
             .WithMany(r => r.Tasks)
             .HasForeignKey(x => x.RoId);
            b.HasOne(x => x.Operation).WithMany().HasForeignKey(x => x.OperationId);
            b.HasOne(x => x.Station).WithMany().HasForeignKey(x => x.StationId);
            b.HasOne(x => x.AssignedToUser).WithMany().HasForeignKey(x => x.AssignedToUserId);
            b.HasOne(x => x.AssignedByUser).WithMany().HasForeignKey(x => x.AssignedByUserId);
        });

        // --- Production ---
        mb.Entity<KanbanStage>(b =>
        {
            b.ToTable("kanban_stages");
            b.HasKey(x => x.Id);
        });

        mb.Entity<RoKanbanState>(b =>
        {
            b.ToTable("ro_kanban_state");
            b.HasKey(x => x.RoId);
            b.HasOne(x => x.RepairOrder).WithMany().HasForeignKey(x => x.RoId);
            b.HasOne(x => x.CurrentStage).WithMany().HasForeignKey(x => x.CurrentStageId);
        });

        mb.Entity<VarianceReason>(b =>
        {
            b.ToTable("variance_reasons");
            b.HasKey(x => x.Id);
        });

        mb.Entity<VarianceRecord>(b =>
        {
            b.ToTable("variance_records");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.Property(x => x.DeltaHours).ValueGeneratedOnAddOrUpdate();
            b.Property(x => x.DeltaPercent).HasColumnName("delta_percent").ValueGeneratedOnAddOrUpdate();
            b.HasOne(x => x.Task).WithMany().HasForeignKey(x => x.TaskId);
            b.HasOne(x => x.Reason).WithMany().HasForeignKey(x => x.ReasonId);
        });

        mb.Entity<TimeEntry>(b =>
        {
            b.ToTable("time_entries");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.Property(x => x.DurationMinutes).ValueGeneratedOnAddOrUpdate();
            b.HasOne(x => x.Task).WithMany().HasForeignKey(x => x.TaskId);
            b.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId);
        });

        // Keyless entity for v_station_load view
        mb.Entity<StationLoadDto>(b =>
        {
            b.HasNoKey();
            b.ToView("v_station_load");
            b.Property(x => x.StationId).HasColumnName("station_id");
            b.Property(x => x.StationCode).HasColumnName("station_code");
            b.Property(x => x.StationName).HasColumnName("station_name");
            b.Property(x => x.OwnerName).HasColumnName("owner_name");
            b.Property(x => x.OpenTasks).HasColumnName("open_tasks");
            b.Property(x => x.ActiveTasks).HasColumnName("active_tasks");
            b.Property(x => x.HoursRemaining).HasColumnName("hours_remaining");
        });

        // Keyless entity for v_template_calibration view
        mb.Entity<TemplateCalibrationDto>(b =>
        {
            b.HasNoKey();
            b.ToView("v_template_calibration");
            b.Property(x => x.TemplateCode).HasColumnName("template_code");
            b.Property(x => x.OperationName).HasColumnName("operation_name");
            b.Property(x => x.TemplateEstimate).HasColumnName("template_estimate");
            b.Property(x => x.AvgActual).HasColumnName("avg_actual");
            b.Property(x => x.AvgDelta).HasColumnName("avg_delta");
            b.Property(x => x.SampleSize).HasColumnName("sample_size");
            b.Property(x => x.StddevActual).HasColumnName("stddev_actual");
        });

        // --- QC ---
        mb.Entity<QcSubmission>(b =>
        {
            b.ToTable("qc_submissions");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.Property(x => x.ItemResponses).HasColumnType("jsonb");
            b.HasOne(x => x.RepairOrder).WithMany().HasForeignKey(x => x.RoId);
            b.HasOne(x => x.Task).WithMany().HasForeignKey(x => x.TaskId);
        });

        mb.Entity<QcChecklistItem>(b =>
        {
            b.ToTable("qc_checklist_items");
            b.HasKey(x => x.Id);
        });

        mb.Entity<QcResult>(b =>
        {
            b.ToTable("qc_results");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.HasIndex(x => new { x.RoId, x.ItemCode }).IsUnique();
        });

        // --- Attachments ---
        mb.Entity<Attachment>(b =>
        {
            b.ToTable("attachments");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.Property(x => x.UploadedAt).HasDefaultValueSql("now()");
        });

        // --- Notifications ---
        mb.Entity<Notification>(b =>
        {
            b.ToTable("notifications");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.Property(x => x.CreatedAt).HasDefaultValueSql("now()");
        });

        // --- Flow definitions ---
        mb.Entity<FlowDefinition>(b =>
        {
            b.ToTable("flow_definitions");
            b.HasKey(x => x.Id);
            b.HasIndex(x => new { x.BodyType, x.Track, x.SortOrder }).IsUnique();
            b.HasIndex(x => new { x.BodyType, x.Track, x.StationId }).IsUnique();
            b.HasOne(x => x.Station).WithMany().HasForeignKey(x => x.StationId);
        });

        // --- Scheduling ---
        mb.Entity<ChassisInventory>(b =>
        {
            b.ToTable("chassis_inventory");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.HasOne(x => x.AllocatedRo).WithMany().HasForeignKey(x => x.AllocatedToRo);
        });

        mb.Entity<ChassisStockUpload>(b =>
        {
            b.ToTable("chassis_stock_uploads");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.Property(x => x.ParseErrors).HasColumnType("jsonb");
            b.Property(x => x.UploadedAt).HasDefaultValueSql("now()");
        });

        mb.Entity<CustomerApproval>(b =>
        {
            b.ToTable("customer_approvals");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).HasDefaultValueSql("gen_random_uuid()");
            b.HasOne<RepairOrder>().WithMany().HasForeignKey(x => x.RoId);
        });

        // --- Audit ---
        mb.Entity<DomainEvent>(b =>
        {
            b.ToTable("domain_events");
            b.HasKey(x => x.Id);
            b.Property(x => x.Id).UseIdentityColumn();
            b.Property(x => x.Payload).HasColumnName("payload").HasColumnType("jsonb");
            b.Property(x => x.OccurredAt).HasColumnName("occurred_at").HasDefaultValueSql("now()");
            b.Property(x => x.UserId).HasColumnName("user_id");
        });
    }
}
